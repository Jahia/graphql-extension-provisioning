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
 *   F3 — the module ships NO permission of its own, and the CORE permission it gates on is present
 *        at `/permissions/provisioningApi/provisioningAccess`.
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

    // F3: this module gates on a CORE permission and declares none of its own.
    //
    // Jahia ships `provisioningAccess` at /permissions/provisioningApi/provisioningAccess, where
    // `provisioningApi` is a grouping node and `provisioningAccess` is the grantable permission —
    // the same one that gates core's Provisioning API. Registration is by NAME into
    // JahiaPrivilegeRegistry's in-memory map, so a module redeclaring that name would contribute
    // nothing to the privilege while creating a second, differently named parent above it. A parent
    // is an aggregate, so such a node becomes an extra grant path to an RCE-equivalent capability.
    //
    // Both halves are asserted, because each fails in a different direction: losing the core node
    // means the gate can never be satisfied by a grant, and gaining a module-local declaration
    // means the duplicate has been reintroduced.
    const corePermission = gql`
        query {
            jcr(workspace: EDIT) {
                nodeByPath(path: "/permissions/provisioningApi/provisioningAccess") {
                    name
                    primaryNodeType { name }
                    parent { name }
                }
            }
        }
    `;

    const modulePermissions = gql`
        query {
            jcr(workspace: EDIT) {
                nodesByQuery(
                    query: "select * from [jnt:permission] where isdescendantnode('/modules/graphql-extension-provisioning')"
                ) {
                    nodes { path }
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

    it('F3 — the core provisioningAccess permission is present under the provisioningApi group', () => {
        cy.apollo({query: corePermission, errorPolicy: 'all'})
            .then((result: {
                data?: {jcr?: {nodeByPath?: {name: string; primaryNodeType: {name: string}; parent: {name: string}}}};
                errors?: Array<{message: string}>;
            }) => {
                expect(result.errors ?? [], `core permission lookup must not error [${(result.errors ?? []).map(e => e.message).join(' | ')}]`)
                    .to.have.length(0);
                const node = result.data?.jcr?.nodeByPath;
                expect(node?.name, 'the grantable permission').to.eq('provisioningAccess');
                expect(node?.primaryNodeType?.name, 'permission node type').to.eq('jnt:permission');
                expect(node?.parent?.name, 'declared under the provisioningApi group').to.eq('provisioningApi');
            });
    });

    it('F3 — the module declares no permission of its own', () => {
        cy.apollo({query: modulePermissions, errorPolicy: 'all'})
            .then((result: {
                data?: {jcr?: {nodesByQuery?: {nodes: Array<{path: string}>}}};
                errors?: Array<{message: string}>;
            }) => {
                expect(result.errors ?? [], 'module subtree lookup must not error').to.have.length(0);
                const paths = (result.data?.jcr?.nodesByQuery?.nodes ?? []).map(n => n.path);

                // Jahia creates `permissions` and `permissions/templates` under EVERY module, with or
                // without a permissions.xml, so their presence says nothing. What must not appear is a
                // declaration of the permission this module gates on, or of a parent above it.
                const reintroduced = paths.filter(path => /\/(provisioningAccess|provisioningApi|graphql)$/.test(path));

                // Redeclaring a platform permission adds nothing to the privilege and creates an
                // unintended aggregate above it. If this fails, src/main/import/permissions.xml is back.
                expect(reintroduced, `the module must declare no provisioning permission; found ${JSON.stringify(reintroduced)}`)
                    .to.have.length(0);
            });
    });
});
