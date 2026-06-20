import {DocumentNode} from 'graphql';

describe('GraphQL Extension Provisioning - Authorization', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const executeScript: DocumentNode = require('graphql-tag/loader!../fixtures/graphql/mutation/executeScript.graphql');

    // A script that would succeed for a privileged user; we use it to confirm
    // it is NOT executed when authorization is denied.
    const script = '- karafCommand: "log:log \'graphql-extension-provisioning auth-test — MUST NOT RUN\'"';

    it('returns a GraphQL permission error when called without authentication', () => {
        // cy.apollo with no prior cy.login() sends the request as anonymous.
        // @jahia/cypress apollo helper propagates the GQL errors array in the response.
        cy.apollo({
            mutation: executeScript,
            variables: {script},
            // Prevent Cypress from treating GQL errors as test failures so we can assert on them.
            errorPolicy: 'all'
        }).then(response => {
            // The mutation data field must be absent or null — the script must not have run.
            expect(response.data?.admin?.jahia?.executeScript ?? null).to.be.null;

            // The response must carry at least one GraphQL error indicating missing permission.
            expect(response.errors).to.be.an('array').that.has.length.greaterThan(0);

            const errorMessages: string = response.errors
                .map((e: {message: string}) => e.message)
                .join(' ');
            // The error message from @GraphQLRequiresPermission contains "permission".
            expect(errorMessages.toLowerCase()).to.include('permission');
        });
    });

    it('returns a GraphQL permission error when called as a non-privileged user', () => {
        // Log in as the built-in guest/anonymous user (no provisioningApi permission).
        cy.login('guest', 'guest');

        cy.apollo({
            mutation: executeScript,
            variables: {script},
            errorPolicy: 'all'
        }).then(response => {
            expect(response.data?.admin?.jahia?.executeScript ?? null).to.be.null;

            expect(response.errors).to.be.an('array').that.has.length.greaterThan(0);

            const errorMessages: string = response.errors
                .map((e: {message: string}) => e.message)
                .join(' ');
            expect(errorMessages.toLowerCase()).to.include('permission');
        });
    });
});
