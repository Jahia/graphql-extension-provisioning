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

    it('executes synchronously — blocks the request thread until the script completes', () => {
        // F8: the mutation is documented as synchronous. A `shell:sleep 3000` step therefore
        // must not return before ~3s of wall-clock time has elapsed. An async/job-based refactor
        // would return early and fail the elapsed-time lower bound. No upper bound is asserted
        // (network + processing only add time), keeping the check robust against timing jitter.
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
