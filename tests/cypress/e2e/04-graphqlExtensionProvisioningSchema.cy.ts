import gql from 'graphql-tag';

/**
 * Schema-shape and deployment guards (gap-list D1 / F6 / F3 / F7).
 *
 * The real mutation path is `admin.jahia.provisioning.executeScript` — NOT the flat
 * `admin.jahia.executeScript` printed in the README/AGENTS.md (a documented-but-invalid shape).
 * These tests pin the true schema so a regression in either direction fails loudly:
 *   D1 — the documented flat path is a GraphQL VALIDATION error; the nested path is ground truth.
 *   F6 — `ProvisioningAdminMutation` exposes exactly one field `executeScript(script: String): Boolean`,
 *        and `JahiaAdminMutation` carries a `provisioning` field of that type.
 *   F3 — the module's JCR import created `/permissions/graphql/provisioningApi` (both nodes jnt:permission).
 *   F7 — install/start smoke: the type being present in the schema ⇒ the bundle is ACTIVE and its
 *        DS component registered the GraphQL contribution.
 */
describe('GraphQL Extension Provisioning — schema shape & deployment', () => {
    before(() => {
        cy.login(); // Root — removes any authorization confounder so D1 act 1 can only be a validation error
    });

    // --- F6 / F7: introspect the leaf type -----------------------------------------------------
    const introspectAdminMutationType = gql`
        query {
            __type(name: "ProvisioningAdminMutation") {
                name
                fields {
                    name
                    args { name type { kind name ofType { name kind } } }
                    type { kind name ofType { name kind } }
                }
            }
        }
    `;

    // --- D1 / F6: introspect the parent type that should carry `provisioning` (and NOT `executeScript`)
    const introspectParentType = gql`
        query {
            __type(name: "JahiaAdminMutation") {
                fields {
                    name
                    type { name kind ofType { name } }
                }
            }
        }
    `;

    const permissionNode = gql`
        query {
            jcr(workspace: EDIT) {
                nodeByPath(path: "/permissions/graphql/provisioningApi") {
                    name
                    primaryNodeType { name }
                    parent { name primaryNodeType { name } }
                }
            }
        }
    `;

    interface IntrospectedField {
        name: string;
        args?: Array<{name: string; type: {kind: string; name: string | null; ofType: {name: string | null; kind: string} | null}}>;
        type?: {kind: string; name: string | null; ofType: {name: string | null; kind?: string} | null};
    }

    it('F6/F7 — ProvisioningAdminMutation exposes exactly executeScript(script: String): Boolean', () => {
        cy.apollo({query: introspectAdminMutationType, errorPolicy: 'all'})
            .then((result: {data?: {__type?: {name: string; fields: IntrospectedField[]}}; errors?: unknown[]}) => {
                expect(result.errors ?? [], 'introspection must not error').to.have.length(0);
                const type = result.data?.__type;
                // Type present ⇒ bundle ACTIVE and DS component registered (F7 smoke).
                expect(type?.name, 'ProvisioningAdminMutation type must exist').to.eq('ProvisioningAdminMutation');

                const fields = type?.fields ?? [];
                expect(fields.map(f => f.name), 'exactly one field: executeScript').to.deep.eq(['executeScript']);

                const executeScript = fields[0];
                expect(executeScript.type?.name, 'return type is Boolean').to.eq('Boolean');
                expect(executeScript.args, 'one arg').to.have.length(1);
                const arg = executeScript.args?.[0];
                expect(arg?.name, 'arg name is script').to.eq('script');
                expect(arg?.type?.name, 'arg type is String').to.eq('String');
            });
    });

    it('D1/F6 — JahiaAdminMutation carries `provisioning` (of type ProvisioningAdminMutation) and NO flat `executeScript`', () => {
        cy.apollo({query: introspectParentType, errorPolicy: 'all'})
            .then((result: {data?: {__type?: {fields: IntrospectedField[]}}; errors?: unknown[]}) => {
                expect(result.errors ?? [], 'introspection must not error').to.have.length(0);
                const fields = result.data?.__type?.fields ?? [];
                const names = fields.map(f => f.name);

                expect(names, 'the flat path admin.jahia.executeScript must NOT exist').to.not.include('executeScript');
                expect(names, 'the nested container `provisioning` must exist').to.include('provisioning');

                const provisioning = fields.find(f => f.name === 'provisioning');
                expect(provisioning?.type?.name, '`provisioning` returns ProvisioningAdminMutation')
                    .to.eq('ProvisioningAdminMutation');
            });
    });

    it('D1 — the documented flat mutation admin.jahia.executeScript fails GraphQL validation', () => {
        // Sent EXACTLY as printed in the README. Root is logged in (session cookie shared with
        // cy.request), so any failure is a schema-VALIDATION error, not authorization.
        const query = 'mutation { admin { jahia { executeScript(script: "- karafCommand: \\"log:log \'test\'\\"") } } }';
        cy.request({
            method: 'POST',
            url: '/modules/graphql',
            headers: {'Content-Type': 'application/json'},
            body: {query},
            failOnStatusCode: false
        }).then((res: {body: {data?: unknown; errors?: Array<{message: string}>}}) => {
            const errors = res.body?.errors ?? [];
            expect(errors, 'the invalid flat path must produce a validation error').to.have.length.greaterThan(0);
            const combined = errors.map(e => e.message).join(' ');
            expect(combined).to.match(/FieldUndefined|Field ['`]?executeScript['`]?.*(undefined|not defined|in type)/i);
            // Nothing executed: no usable data for the invalid selection.
            expect(res.body?.data ?? null, 'no data for an invalid query').to.be.null;
        });
    });

    it('F3 — the module import created /permissions/graphql/provisioningApi (both nodes jnt:permission)', () => {
        cy.apollo({query: permissionNode, errorPolicy: 'all'})
            .then((result: {
                data?: {jcr?: {nodeByPath?: {name: string; primaryNodeType: {name: string}; parent: {name: string; primaryNodeType: {name: string}}}}};
                errors?: unknown[];
            }) => {
                expect(result.errors ?? [], 'permission node lookup must not error').to.have.length(0);
                const node = result.data?.jcr?.nodeByPath;
                expect(node?.name, 'permission node name').to.eq('provisioningApi');
                expect(node?.primaryNodeType?.name, 'permission node type').to.eq('jnt:permission');
                // Also pins the shipped tree shape (guards D5: README's jnt:permissionGroup divergence).
                expect(node?.parent?.name, 'parent node name').to.eq('graphql');
                expect(node?.parent?.primaryNodeType?.name, 'parent node type').to.eq('jnt:permission');
            });
    });
});
