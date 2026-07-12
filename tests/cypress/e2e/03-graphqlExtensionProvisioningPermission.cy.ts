import {DocumentNode} from 'graphql';
import gql from 'graphql-tag';
import {createUser, deleteUser, grantRoles, addNode, deleteNode} from '@jahia/cypress';

/**
 * Security-critical permission-gate coverage (gap-list F2a / F2b / U6).
 *
 * The leaf `executeScript` field carries `@GraphQLRequiresPermission("provisioningApi")`
 * (ProvisioningAdminMutation.java). graphql-dxm-provider evaluates that permission with the
 * CALLING USER's own JCR session against the repository ROOT node — the checker hardcodes
 * `path = "/"` because the permission name contains no `/`. So only a SERVER-level (root) grant
 * of `provisioningApi` unlocks the mutation; a grant at any non-root node (e.g. a site) is
 * fail-closed and does NOT work. The intermediate `provisioning` container is unannotated, so any
 * authenticated caller may select it — the gate is on the leaf only.
 *
 * These tests pin all three halves of that contract with NON-root users:
 *   F2a — an authenticated user WITHOUT the permission is denied ("Permission denied") and the
 *         script is NOT executed (denial is pre-resolver, so a denied call never runs the body).
 *   F2b — an authenticated user WITH a root-level `provisioningApi` grant succeeds; and the
 *         required negative sub-case: the same permission granted only at a SITE node still denies.
 *   U6  — the same denied user CAN select the `provisioning` container (`__typename`) without error.
 *
 * IMPORTANT: `cy.apollo` authenticates as `root` by default. To exercise the permission check we
 * MUST route each call through `cy.apolloClient({username, password})` so it runs as the intended
 * NON-root user (mirrors the sibling permission specs in this initiative).
 */
describe('GraphQL Extension Provisioning — permission gate (non-root users)', () => {
    const ROLE_NAME = 'provisioning-api-tester';
    const ROLE_PATH = `/roles/${ROLE_NAME}`;

    const DENIED_USER = 'provisioning-denied-user';
    const GRANTED_USER = 'provisioning-granted-user';
    const SITE_USER = 'provisioning-site-user';
    const PASSWORD = 'Provisioning9PwdTest';

    // A non-root node that always exists — used for the fail-closed "granted at a site, not at /"
    // negative sub-case. Granting here must NOT satisfy the root-node check.
    const SITE_NODE = '/sites/systemsite';

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const executeScript: DocumentNode = require('graphql-tag/loader!../fixtures/graphql/mutation/executeScript.graphql');

    // Marker scripts: if the resolver ever ran despite denial, these log lines would appear in the
    // Jahia container log. Non-execution is guaranteed by pre-resolver denial (a "Permission denied"
    // error entails the body never ran), asserted here via the error + null-data pair.
    const DENIED_MARKER = '- karafCommand: "log:log \'F2a MUST NOT RUN\'"';
    const GRANTED_MARKER = '- karafCommand: "log:log \'F2b granted-user run\'"';

    // Alias hardening: the permission lookup keys on the field NAME, never the alias, so an aliased
    // selection must be denied identically — closing the "alias bypass" question.
    const aliasedExecuteScript = gql`
        mutation ($script: String!) {
            admin { jahia { provisioning { x: executeScript(script: $script) } } }
        }
    `;

    // Selects only the ungated container — no leaf field, so no permission is required (U6).
    const selectContainer = gql`
        mutation {
            admin { jahia { provisioning { __typename } } }
        }
    `;

    interface DenialResult {
        data?: {admin?: {jahia?: {provisioning?: {executeScript?: boolean | null; x?: boolean | null} | null}}};
        errors?: Array<{message: string}>;
    }

    const messagesOf = (result: DenialResult): string =>
        (result.errors ?? []).map(error => error.message).join(' ');

    before(() => {
        cy.login(); // Root
        createUser(DENIED_USER, PASSWORD);
        createUser(GRANTED_USER, PASSWORD);
        createUser(SITE_USER, PASSWORD);

        // A server-scoped role carrying ONLY `provisioningApi`. The module ships no role, so the
        // test provisions one directly (jnt:role under /roles), mirroring the shipped server-role
        // shape (roleGroup=server-role, privilegedAccess, rep:root node type).
        addNode({
            parentPathOrId: '/roles',
            primaryNodeType: 'jnt:role',
            name: ROLE_NAME,
            properties: [
                {name: 'j:permissionNames', values: ['provisioningApi'], type: 'STRING'},
                {name: 'j:roleGroup', value: 'server-role', type: 'STRING'},
                {name: 'j:nodeTypes', values: ['rep:root'], type: 'STRING'},
                {name: 'j:privilegedAccess', value: 'true', type: 'BOOLEAN'}
            ]
        });

        // Root-level grant → unlocks the mutation for GRANTED_USER (getNode("/").hasPermission).
        grantRoles('/', [ROLE_NAME], GRANTED_USER, 'USER');
        // Site-level grant → must NOT unlock it (root-only check); fail-closed negative sub-case.
        grantRoles(SITE_NODE, [ROLE_NAME], SITE_USER, 'USER');
    });

    after(() => {
        cy.apolloClient(); // Reset the current Apollo client back to root
        cy.login();
        deleteUser(DENIED_USER);
        deleteUser(GRANTED_USER);
        deleteUser(SITE_USER);
        deleteNode(ROLE_PATH);
    });

    it('F2a — denies an authenticated user WITHOUT provisioningApi and does NOT execute the script', () => {
        cy.apolloClient({username: DENIED_USER, password: PASSWORD})
            .apollo({
                mutation: executeScript,
                variables: {script: DENIED_MARKER},
                errorPolicy: 'all'
            })
            .then((result: DenialResult) => {
                expect(result.errors ?? [], 'a Permission denied error is expected').to.have.length.greaterThan(0);
                expect(messagesOf(result)).to.contain('Permission denied');
                // Pre-resolver denial ⇒ the resolver body never ran; the field resolves to null,
                // never true. (No 401/403 tolerance here — an authenticated known user must reach
                // GraphQL and be denied at the JCR gate, unlike the anonymous path in spec 02.)
                expect(
                    result.data?.admin?.jahia?.provisioning?.executeScript ?? null,
                    'denied caller must never execute the script'
                ).to.be.null;
            });
    });

    it('F2a — aliasing the leaf field does not bypass the permission gate', () => {
        cy.apolloClient({username: DENIED_USER, password: PASSWORD})
            .apollo({
                mutation: aliasedExecuteScript,
                variables: {script: DENIED_MARKER},
                errorPolicy: 'all'
            })
            .then((result: DenialResult) => {
                expect(messagesOf(result), 'alias must be denied identically').to.contain('Permission denied');
                expect(result.data?.admin?.jahia?.provisioning?.x ?? null, 'aliased field must not execute').to.be.null;
            });
    });

    it('U6 — the same denied user CAN select the ungated provisioning container', () => {
        cy.apolloClient({username: DENIED_USER, password: PASSWORD})
            .apollo({
                mutation: selectContainer,
                errorPolicy: 'all'
            })
            .then((result: {data?: {admin?: {jahia?: {provisioning?: {__typename?: string}}}}; errors?: unknown[]}) => {
                expect(result.errors ?? [], 'selecting the container must not error').to.have.length(0);
                expect(result.data?.admin?.jahia?.provisioning?.__typename).to.eq('ProvisioningAdminMutation');
            });
    });

    it('F2b — a user granted provisioningApi at the JCR root succeeds', () => {
        cy.apolloClient({username: GRANTED_USER, password: PASSWORD})
            .apollo({
                mutation: executeScript,
                variables: {script: GRANTED_MARKER},
                errorPolicy: 'all'
            })
            .then((result: DenialResult) => {
                expect(result.errors ?? [], 'granted caller must have no errors').to.have.length(0);
                expect(
                    result.data?.admin?.jahia?.provisioning?.executeScript,
                    'granted caller must execute the script'
                ).to.eq(true);
            });
    });

    it('F2b — the same permission granted only at a SITE node still denies (root-only check)', () => {
        cy.apolloClient({username: SITE_USER, password: PASSWORD})
            .apollo({
                mutation: executeScript,
                variables: {script: DENIED_MARKER},
                errorPolicy: 'all'
            })
            .then((result: DenialResult) => {
                // Fail-closed: provisioningApi is resolved on "/", so a site-scoped grant does not
                // satisfy it. This is the mistake an operator will plausibly make.
                expect(messagesOf(result), 'site-level grant must not unlock the mutation').to.contain('Permission denied');
                expect(result.data?.admin?.jahia?.provisioning?.executeScript ?? null).to.be.null;
            });
    });
});
