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
            .its('data.admin.jahia.executeScript')
            .should('eq', true);
    });

    it('returns false when executing an invalid YAML script', () => {
        const script = '{ invalid yaml: [unclosed';
        cy.apollo({
            mutation: executeScript,
            variables: {script}
        })
            .its('data.admin.jahia.executeScript')
            .should('eq', false);
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
            .its('data.admin.jahia.executeScript')
            .should('eq', true);
    });
});
