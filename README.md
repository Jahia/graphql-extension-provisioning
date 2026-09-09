# Jahia GraphQL Extension Provisioning

The purpose of this module is to expose the Jahia Provisioning API through GraphQL mutations, allowing the execution of YAML provisioning scripts directly via GraphQL queries.

## Security — IMPORTANT

### Risk level: Remote Code Execution equivalent

The `executeScript` mutation can execute arbitrary Jahia provisioning YAML scripts.
A provisioning script can install or remove OSGi bundles, run Karaf shell commands,
modify JCR content, and more. **Treat access to this mutation with the same caution as
shell access to the server.**

### The `provisioningAccess` permission

Access is gated by `@GraphQLRequiresPermission("provisioningAccess")`, checked at the
repository root.

This is a **platform permission shipped by Jahia core**, not by this module. Core declares
it at `/permissions/provisioningApi/provisioningAccess`, where `provisioningApi` is a
grouping node and `provisioningAccess` is the permission you grant. It is the same
permission that gates Jahia's own Provisioning API, which is deliberate: this module
exposes the provisioning API over GraphQL, so it gates on the permission that already
governs it rather than inventing one.

The module therefore ships no permission of its own and needs no JCR import. Nothing has
to be created by hand.

#### Who holds it by default

Jahia grants `provisioningAccess` to the **`system-administrator`** role, including at the
repository root, so that role can call this mutation on a stock installation.

Privilege aggregation runs downwards, so a role granted the enclosing `provisioningApi`
also satisfies the check. A role granted only `provisioningAccess` does **not** gain
`provisioningApi`.

#### Granting it to anyone else

`provisioningAccess` confers the ability to run arbitrary provisioning scripts, over this
mutation and over core's Provisioning API alike. Grant it only to `system-administrator`,
or to a dedicated role restricted to trusted automation accounts.

**Never grant it to:**
- Site administrators
- Editors or contributors
- Any role that can be self-assigned by end users
- Anonymous or guest users

#### Verifying who holds it

In the Jahia Administration panel, go to **Administration > Roles & permissions** and check
which roles hold `provisioningAccess`. It is listed under the `provisioningApi` group, as
core declares it. Remember to check `provisioningApi` itself too: granting the group
implies the permission.

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
| `ProvisioningAdminMutation` | The type `provisioning` returns; carries `executeScript`, gated by `@GraphQLRequiresPermission("provisioningAccess")` |

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
