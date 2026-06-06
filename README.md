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
Jahia permission** that must be explicitly declared in the JCR and then granted to one
or more roles — it is **not** a built-in Jahia permission and grants **no access by
default** until you create and assign it.

#### Declaring the permission in JCR

Add the following node under `/permissions` (e.g. via a module's `repository.xml` import
or through the Jahia Administration > JCR Browser):

```xml
<permissions jcr:primaryType="jnt:permission">
  <graphql jcr:primaryType="jnt:permissionGroup">
    <provisioningApi jcr:primaryType="jnt:permission"/>
  </graphql>
</permissions>
```

The full JCR path of the permission once created will be:
`/permissions/graphql/provisioningApi`

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
confirm `provisioningApi` appears under the `graphql` permission group, and that only
the intended roles have it.

### Recommended network controls

In addition to the permission gate, consider restricting the GraphQL admin endpoint
(`/graphql`) at the network or reverse-proxy level so it is not reachable from the
public internet.

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
            executeScript(script: "- installBundle: \"mvn:org.jahia.modules/article/3.2.0\"")
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
