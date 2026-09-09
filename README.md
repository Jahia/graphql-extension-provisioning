# Jahia GraphQL Extension Provisioning

The purpose of this module is to expose the Jahia Provisioning API through GraphQL mutations, allowing the execution of YAML provisioning scripts directly via GraphQL queries.

## Security — IMPORTANT

### Risk level: Remote Code Execution equivalent

The `executeScript` mutation can execute arbitrary Jahia provisioning YAML scripts.
A provisioning script can install or remove OSGi bundles, run Karaf shell commands,
modify JCR content, and more. **Treat access to this mutation with the same caution as
shell access to the server.**

### The `provisioningApi` permission

Access is gated by `@GraphQLRequiresPermission("provisioningApi")`. This is a **custom
Jahia permission** that is **shipped by this module** — it is registered automatically
when the module is first deployed (or when it is deployed with a new version). It grants
**no access by default** until you assign it to one or more roles.

The permission is declared by `src/main/import/permissions.xml` and lives in the module's
own tree, at `/modules/graphql-extension-provisioning/<version>/permissions/graphql/provisioningApi`.
Jahia registers privileges by **name**, so the name to grant is `provisioningApi`, and the
gate checks it at the repository root. Note that the enclosing `graphql` node is itself a
permission: Jahia aggregates downwards, so granting `graphql` implies `provisioningApi`,
while granting `provisioningApi` does not imply `graphql`.

#### Declaring the permission in JCR (manual fallback)

If you need to create the permission manually (e.g. for an older deployment where the
import has not run), add the following node under `/permissions` via the Jahia
Administration > JCR Browser:

```xml
<permissions jcr:primaryType="jnt:permission">
  <graphql jcr:primaryType="jnt:permission">
    <provisioningApi jcr:primaryType="jnt:permission"/>
  </graphql>
</permissions>
```

This mirrors what `src/main/import/permissions.xml` ships, including the `graphql` node
and its `jnt:permission` type. Keep the nesting: it is what makes `graphql` an aggregate
of `provisioningApi`. Use `jnt:permission` for both nodes — `jnt:permissionGroup` is not a
Jahia node type, and an import naming it fails.

**Why this works even though the module writes elsewhere.** Jahia registers privileges into
one in-memory map, from two sources: the global `/permissions` tree, read at startup and
refreshed by `PrivilegesListener`, and each module's own subtree, read by
`addModulePrivileges`. Enforcement only ever consults that map, by name — a JCR node is an
input to registration, never what the gate reads. So the module registering from
`/modules/<id>/<version>/permissions` and this fallback writing under `/permissions` both
produce the same effective `provisioningApi` privilege.

One rider if you use the fallback: the `graphql` node it creates is *global*. Privileges are
deduplicated by name, so it merges with any other module's top-level `graphql` node rather
than conflicting. Granting `graphql` may therefore aggregate more than this module's leaf.

#### Recommended role assignment

Assign the `provisioningApi` permission **only** to the `server-administrator` role
(or a dedicated role restricted to trusted automation accounts).

**Never grant this permission to:**
- Site administrators
- Editors or contributors
- Any role that can be self-assigned by end users
- Anonymous or guest users

#### Verifying the permission is in place

In the Jahia Administration panel, go to **Administration > Roles & permissions** and
confirm `provisioningApi` is listed, and that only the intended roles have it. Look for it
by name: there is no `/permissions/graphql/provisioningApi` node in the global permission
tree, so a path-based check against that location finds nothing.

### Recommended network controls

In addition to the permission gate, consider restricting the GraphQL endpoint
(`/modules/graphql`) at the network or reverse-proxy level so it is not reachable from the
public internet. Note the path: a rule written against `/graphql` matches nothing, because
that is not where Jahia serves the API.

## Installation

- In Jahia, go to "Administration --> Server settings --> System components --> Modules"
- Upload the JAR **graphql-extension-provisioning-X.X.X.jar**
- Check that the module is started

## How to use
### In the tools

- Go to the page **"Jahia GraphQL Core Provider : graphql-playground"** (JAHIA_URL/modules/graphql-dxm-provider/tools/graphql-playground.jsp)

#### Execute a provisioning script inline
Provide a YAML provisioning script directly as a string:
```graphql
mutation {
    admin {
        jahia {
            provisioning {
                executeScript(script: "- installBundle: \"mvn:org.jahia.modules/article/3.2.0\"")
            }
        }
    }
}
```

## Provisioning script format

Jahia provisioning scripts are written in YAML. Example:
```yaml
- installBundle: "mvn:org.jahia.modules/article/3.2.0"
- installBundle: "mvn:org.jahia.modules/news/3.1.0"
  autoStart: true
```

Refer to the [Jahia Provisioning API documentation](https://academy.jahia.com/documentation/developer/jahia/8/jahia-provisioning-api) for the full list of supported operations.

## Module architecture

| Class | Role |
|-------|------|
| `DXGraphQLExtensionProvisioningProvider` | OSGi DS `@Component` that registers `ProvisioningMutation` with the DXM GraphQL provider via `DXGraphQLExtensionsProvider` |
| `ProvisioningMutation` | `@GraphQLTypeExtension(GqlJahiaAdminMutation.class)` — adds the `provisioning` field under `admin.jahia` |
| `ProvisioningAdminMutation` | The type `provisioning` returns; carries `executeScript`, gated by `@GraphQLRequiresPermission("provisioningApi")` |

## Troubleshooting

### `executeScript` returns `false` immediately without running the script

**Cause:** The `ProvisioningManager` OSGi service was unavailable at call time (e.g. the
Jahia provisioning bundle is not started, or the OSGi framework was still initialising).

**Resolution:**
1. Confirm the `org.jahia.services.provisioning` bundle is in `Active` state in the Karaf
   console (`bundle:list | grep provisioning`).
2. If the bundle is present but not active, start it: `bundle:start <id>`.
3. Retry the mutation. The lookup is attempted on every call, so no module restart is
   required once the service becomes available.
