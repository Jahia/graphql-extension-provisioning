import {DocumentNode} from 'graphql';

describe('GraphQL Extension Provisioning', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const executeScript: DocumentNode = require('graphql-tag/loader!../fixtures/graphql/mutation/executeScript.graphql');
    before(() => {
        cy.login();
    });

    it('executes a valid YAML provisioning script and returns true', () => {
        const script = '- karafCommand: "log:log \'graphql-extension-provisioning cypress test\'"';
        cy.apollo({
            mutation: executeScript,
            variables: {script}
        })
            .its('data.admin.jahia.provisioning.executeScript')
            .should('eq', true);
    });

    it('returns false when executing an invalid YAML script (and NO GraphQL error)', () => {
        // F4b: a script failure is signalled purely by the Boolean `false`, never by a
        // GraphQL `errors` entry. Assert the full response so the "no errors" half of the
        // contract is pinned explicitly rather than resting on cy.apollo's default
        // error-rejecting policy.
        const script = '{ invalid yaml: [unclosed';
        cy.apollo({
            mutation: executeScript,
            variables: {script},
            errorPolicy: 'all'
        }).then((response: {data?: {admin?: {jahia?: {provisioning?: {executeScript?: boolean}}}}; errors?: unknown[]}) => {
            expect(response.errors ?? [], 'a script failure must NOT surface as a GraphQL error')
                .to.have.length(0);
            expect(
                response.data?.admin?.jahia?.provisioning?.executeScript,
                'invalid YAML must return false'
            ).to.eq(false);
        });
    });

    it('executes a multi-step YAML provisioning script and returns true', () => {
        const script = [
            '- karafCommand: "log:log \'START - cypress multi-step test\'"',
            '- karafCommand: "log:log \'END - cypress multi-step test\'"'
        ].join('\n');
        cy.apollo({
            mutation: executeScript,
            variables: {script}
        })
            .its('data.admin.jahia.provisioning.executeScript')
            .should('eq', true);
    });

    // F8 — SKIPPED after live investigation (Stage 6). The mutation IS synchronous at the
    // resolver level: ProvisioningAdminMutation.executeScript calls ProvisioningManager.executeScript
    // and returns its Boolean directly, with no Future/job indirection (verified at the source/unit
    // level — see ProvisioningMutationTest). This black-box timing proxy, however, cannot demonstrate
    // that: a `- karafCommand: "shell:sleep 3000"` step returned in ~1s, not >=3s, on a live Jahia.
    // The provisioning layer dispatches a karafCommand without blocking for the shell command's own
    // wall-clock completion, so a karaf sleep is NOT observable as request-thread blocking. There is
    // no reliable, environment-independent provisioning primitive that blocks for a known duration
    // (installBundle timing is network/repo dependent), so this assertion has no honest black-box
    // mechanism. Skipped rather than weakened. NOTE for docs: AGENTS.md's "long-running scripts will
    // block the GraphQL request thread" holds for in-thread provisioning work (e.g. installBundle) but
    // NOT for karafCommand steps, whose execution is dispatched asynchronously by Karaf.
    it.skip('executes synchronously — blocks the request thread until the script completes', () => {
        const start = Date.now();
        const script = '- karafCommand: "shell:sleep 3000"';
        cy.apollo({
            mutation: executeScript,
            variables: {script}
        })
            .its('data.admin.jahia.provisioning.executeScript')
            .should('eq', true)
            .then(() => {
                expect(Date.now() - start, 'synchronous execution must block for the full sleep')
                    .to.be.at.least(3000);
            });
    });
});
