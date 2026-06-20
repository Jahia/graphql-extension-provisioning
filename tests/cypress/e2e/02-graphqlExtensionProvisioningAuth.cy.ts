describe('GraphQL Extension Provisioning - Authorization', () => {
    // A script that would succeed for a privileged user; used to confirm it is
    // NOT executed when the caller lacks the provisioningApi permission.
    const script = '- karafCommand: "log:log \'graphql-extension-provisioning auth-test — MUST NOT RUN\'"'

    const query = 'mutation ($script: String!) { admin { jahia { executeScript(script: $script) } } }'

    it('does not execute the provisioning script for an unauthenticated caller', () => {
        // Send a raw, unauthenticated POST (cy.apollo defaults to root credentials,
        // so it cannot be used to exercise the anonymous path).
        cy.clearCookies()
        cy.request({
            method: 'POST',
            url: '/modules/graphql',
            headers: { 'Content-Type': 'application/json' },
            body: { query, variables: { script } },
            failOnStatusCode: false,
        }).then((res) => {
            if (res.status === 200) {
                // GraphQL reached: the privileged mutation must be refused, so the
                // field must NOT return true and an error must be present.
                const executed = res.body?.data?.admin?.jahia?.executeScript
                expect(executed, 'anonymous caller must not run the script').to.not.equal(true)
                expect(res.body?.errors, 'a GraphQL authorization error is expected')
                    .to.be.an('array')
                    .that.has.length.greaterThan(0)
            } else {
                // Or the request is rejected outright by the security filter.
                expect(res.status).to.be.oneOf([401, 403])
            }
        })
    })
})
