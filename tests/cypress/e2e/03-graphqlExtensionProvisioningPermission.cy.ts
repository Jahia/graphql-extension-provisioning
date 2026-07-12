import {DocumentNode} from 'graphql';
import gql from 'graphql-tag';
import {createUser, deleteUser, grantRoles, addNode, deleteNode} from '@jahia/cypress';

/**
 * Security-critical permission-gate coverage (gap-list F2a / F2b / U6).
 *
 * Reaching the RCE-equivalent leaf `admin.jahia.provisioning.executeScript` crosses a LAYERED
 * (defence-in-depth) permission chain — confirmed by reading graphql-dxm-provider sources:
 *   1. `admin`        → @GraphQLRequiresPermission("jcr:read/jcr:system")  → jcr:read on /jcr:system
 *   2. `admin.jahia`  → @GraphQLRequiresPermission("graphqlAdminMutation") → graphqlAdminMutation at /
 *   3. `provisioning` → (ungated container)
 *   4. `executeScript`→ @GraphQLRequiresPermission("provisioningApi")      → provisioningApi at /
 * Every check resolves against the CALLING user's own JCR session; the leaf and the
 * graphqlAdminMutation checks hardcode the repository ROOT ("/") because the permission name
 * carries no path, so ONLY a server-level (root) grant satisfies them — a grant at any non-root
 * node (e.g. a site) is fail-closed. `jcr:read/jcr:system` embeds its own path (/jcr:system).
 *
 * So provisioningApi-at-root is NECESSARY BUT NOT SUFFICIENT: a caller also needs the ancestor
 * grants to even reach the leaf. These tests pin every load-bearing edge of that contract with
 * NON-root users:
 *   F2a — an authenticated user with NO grants is denied and the script is NOT executed.
 *   F2a — aliasing the leaf field does not bypass the gate (lookup keys on field name, not alias).
 *   U6  — a caller holding the ancestor grants but NOT provisioningApi CAN select the ungated
 *         `provisioning` container (__typename) yet is DENIED on executeScript — proving the leaf
 *         gate is specifically on executeScript, not on the container.
 *   F2b — a caller holding the full chain at ROOT succeeds; and the security-critical negative:
 *         the same caller with provisioningApi granted only at a SITE (ancestors still at root)
 *         is DENIED — proving the leaf's hardcoded root-node check is fail-closed for site grants.
 *
 * IMPORTANT: `cy.apollo` authenticates as `root` by default. To exercise the permission checks we
 * route each call through `cy.apolloClient({username, password})` so it runs as the intended
 * NON-root user. The test env runs with security.profile=open (see assets/provisioning.yml) so the
 * outer API security filter does not pre-empt these MODULE-level GraphQL permission checks.
 */
describe('GraphQL Extension Provisioning — permission gate (non-root users)', () => {
    // Ancestor grants needed to traverse admin -> admin.jahia -> provisioning (but NOT the leaf).
    const ANCESTOR_ROLE = 'provisioning-ancestor-tester';
    // The leaf permission under test, isolated in its own role so its grant location can vary.
    const LEAF_ROLE = 'provisioning-leaf-tester';

    const DENIED_USER = 'provisioning-denied-user';
    const ANCESTOR_USER = 'provisioning-ancestor-user';
    const FULL_USER = 'provisioning-full-user';
    const SITE_USER = 'provisioning-site-user';
    const PASSWORD = 'Provisioning9PwdTest';

    // A non-root node that always exists — used for the fail-closed "leaf granted at a site" case.
    const SITE_NODE = '/sites/systemsite';

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const executeScript: DocumentNode = require('graphql-tag/loader!../fixtures/graphql/mutation/executeScript.graphql');

    // Marker scripts: if a denied resolver ever ran, these log lines would appear in the Jahia log.
    // Non-execution is guaranteed by pre-resolver denial (a "Permission denied" error entails the
    // body never ran), asserted here via the error + null-data pair.
    const DENIED_MARKER = '- karafCommand: "log:log \'F2a MUST NOT RUN\'"';
    const GRANTED_MARKER = '- karafCommand: "log:log \'F2b granted-user run\'"';

    // Alias hardening: the permission lookup keys on the field NAME, never the alias.
    const aliasedExecuteScript = gql`
        mutation ($script: String!) {
            admin { jahia { provisioning { x: executeScript(script: $script) } } }
        }
    `;

    // Selects only the ungated container — no leaf field, so the leaf permission is not required.
    const selectContainer = gql`
        mutation {
            admin { jahia { provisioning { __typename } } }
        }
    `;

    interface DenialResult {
        data?: {admin?: {jahia?: {provisioning?: {executeScript?: boolean | null; x?: boolean | null; __typename?: string} | null}}};
        errors?: Array<{message: string}>;
    }

    const messagesOf = (result: DenialResult): string =>
        (result.errors ?? []).map(error => error.message).join(' | ') || '(no errors)';

    before(() => {
        cy.login(); // Root

        // Ancestor role: the two permissions gating admin (jcr:read on /jcr:system) and admin.jahia
        // (graphqlAdminMutation). NOT provisioningApi.
        addNode({
            parentPathOrId: '/roles',
            primaryNodeType: 'jnt:role',
            name: ANCESTOR_ROLE,
            properties: [
                {name: 'j:permissionNames', values: ['jcr:read', 'graphqlAdminMutation'], type: 'STRING'},
                {name: 'j:roleGroup', value: 'server-role', type: 'STRING'},
                {name: 'j:nodeTypes', values: ['rep:root'], type: 'STRING'},
                {name: 'j:privilegedAccess', value: 'true', type: 'BOOLEAN'}
            ]
        });
        // Leaf role: ONLY provisioningApi, so we can vary WHERE it is granted (root vs site).
        addNode({
            parentPathOrId: '/roles',
            primaryNodeType: 'jnt:role',
            name: LEAF_ROLE,
            properties: [
                {name: 'j:permissionNames', values: ['provisioningApi'], type: 'STRING'},
                {name: 'j:roleGroup', value: 'server-role', type: 'STRING'},
                {name: 'j:nodeTypes', values: ['rep:root'], type: 'STRING'},
                {name: 'j:privilegedAccess', value: 'true', type: 'BOOLEAN'}
            ]
        });

        createUser(DENIED_USER, PASSWORD);
        createUser(ANCESTOR_USER, PASSWORD);
        createUser(FULL_USER, PASSWORD);
        createUser(SITE_USER, PASSWORD);

        // ANCESTOR_USER: ancestor grants at root, but NO provisioningApi anywhere.
        grantRoles('/', [ANCESTOR_ROLE], ANCESTOR_USER, 'USER');
        // FULL_USER: full chain at root → authorized.
        grantRoles('/', [ANCESTOR_ROLE], FULL_USER, 'USER');
        grantRoles('/', [LEAF_ROLE], FULL_USER, 'USER');
        // SITE_USER: ancestors at root (so it reaches the leaf) but provisioningApi only at a SITE
        // → must still be denied, isolating the leaf's root-only requirement.
        grantRoles('/', [ANCESTOR_ROLE], SITE_USER, 'USER');
        grantRoles(SITE_NODE, [LEAF_ROLE], SITE_USER, 'USER');
    });

    after(() => {
        cy.apolloClient(); // Reset the Apollo client back to root
        cy.login();
        deleteUser(DENIED_USER);
        deleteUser(ANCESTOR_USER);
        deleteUser(FULL_USER);
        deleteUser(SITE_USER);
        deleteNode(`/roles/${ANCESTOR_ROLE}`);
        deleteNode(`/roles/${LEAF_ROLE}`);
    });

    it('F2a — denies an authenticated user with NO grants and does NOT execute the script', () => {
        cy.apolloClient({username: DENIED_USER, password: PASSWORD})
            .apollo({mutation: executeScript, variables: {script: DENIED_MARKER}, errorPolicy: 'all'})
            .then((result: DenialResult) => {
                expect(result.errors ?? [], `a Permission denied error is expected [${messagesOf(result)}]`)
                    .to.have.length.greaterThan(0);
                expect(messagesOf(result)).to.contain('Permission denied');
                expect(
                    result.data?.admin?.jahia?.provisioning?.executeScript ?? null,
                    'denied caller must never execute the script'
                ).to.be.null;
            });
    });

    it('F2a — aliasing the leaf field does not bypass the permission gate', () => {
        cy.apolloClient({username: DENIED_USER, password: PASSWORD})
            .apollo({mutation: aliasedExecuteScript, variables: {script: DENIED_MARKER}, errorPolicy: 'all'})
            .then((result: DenialResult) => {
                expect(messagesOf(result), 'alias must be denied identically').to.contain('Permission denied');
                expect(result.data?.admin?.jahia?.provisioning?.x ?? null, 'aliased field must not execute').to.be.null;
            });
    });

    it('U6 — a caller with ancestor grants but no provisioningApi CAN select the container but is DENIED on executeScript', () => {
        // Can select the ungated container (proves ancestors are satisfied and the container itself
        // is not gated)...
        cy.apolloClient({username: ANCESTOR_USER, password: PASSWORD})
            .apollo({mutation: selectContainer, errorPolicy: 'all'})
            .then((result: DenialResult) => {
                expect(result.errors ?? [], `selecting the container must not error [${messagesOf(result)}]`)
                    .to.have.length(0);
                expect(result.data?.admin?.jahia?.provisioning?.__typename).to.eq('ProvisioningAdminMutation');
            });
        // ...but is denied on the leaf executeScript (proves the gate is specifically on the leaf).
        cy.apolloClient({username: ANCESTOR_USER, password: PASSWORD})
            .apollo({mutation: executeScript, variables: {script: DENIED_MARKER}, errorPolicy: 'all'})
            .then((result: DenialResult) => {
                expect(messagesOf(result), 'ancestor-only caller must be denied on the leaf').to.contain('Permission denied');
                expect(result.data?.admin?.jahia?.provisioning?.executeScript ?? null).to.be.null;
            });
    });

    it('F2b — a caller with the full chain granted at the JCR root succeeds', () => {
        cy.apolloClient({username: FULL_USER, password: PASSWORD})
            .apollo({mutation: executeScript, variables: {script: GRANTED_MARKER}, errorPolicy: 'all'})
            .then((result: DenialResult) => {
                expect(result.errors ?? [], `authorized caller must have no errors [${messagesOf(result)}]`)
                    .to.have.length(0);
                expect(
                    result.data?.admin?.jahia?.provisioning?.executeScript,
                    'authorized caller must execute the script'
                ).to.eq(true);
            });
    });

    it('F2b — provisioningApi granted only at a SITE still denies (leaf root-only check)', () => {
        cy.apolloClient({username: SITE_USER, password: PASSWORD})
            .apollo({mutation: executeScript, variables: {script: DENIED_MARKER}, errorPolicy: 'all'})
            .then((result: DenialResult) => {
                // Fail-closed: provisioningApi is resolved on "/", so a site-scoped grant does not
                // satisfy it even though this caller passes the ancestor gates at root.
                expect(messagesOf(result), 'site-level leaf grant must not unlock the mutation').to.contain('Permission denied');
                expect(result.data?.admin?.jahia?.provisioning?.executeScript ?? null).to.be.null;
            });
    });
});
