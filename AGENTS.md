# graphql-extension-provisioning

Jahia OSGi module that exposes a single GraphQL mutation to execute a Jahia provisioning YAML script provided as a string. No admin UI — pure GraphQL API extension.

## Key Facts

- **artifactId**: `graphql-extension-provisioning` | **version**: `1.0.2-SNAPSHOT`
- **Java package**: `org.jahia.community.graphql.provider.dxm.extensions.provisioning`
- **jahia-depends**: `default,graphql-dxm-provider`
- **No frontend**, no admin UI

## Architecture

| Class | Role |
|-------|------|
| `DXGraphQLExtensionProvisioningProvider` | Registers the mutation extension with the DXM GraphQL provider |
| `ProvisioningMutation` | `@GraphQLTypeExtension(GqlJahiaAdminMutation.class)` — adds `executeScript` field |

## GraphQL API

Extends `GqlJahiaAdminMutation` (accessed via `admin.jahia`):

| Operation | Path | Notes |
|-----------|------|-------|
| Mutation | `admin.jahia.executeScript(script: String)` → Boolean | Executes YAML via `ProvisioningManager`; returns `false` on exception |

Permission: `provisioningApi`.

```graphql
mutation {
  admin {
    jahia {
      executeScript(script: "- karafCommand: \"log:log 'test'\"")
    }
  }
}
```

## Build

```bash
mvn clean install
```

No frontend; no `yarn` commands needed.

## Tests (Cypress Docker)

```bash
cd tests
cp .env.example .env
yarn install
./ci.build.sh && ./ci.startup.sh
```

- Tests: `tests/cypress/e2e/01-graphqlExtensionProvisioning.cy.ts`
- Three tests: valid YAML returns `true`, invalid YAML returns `false`, multi-step YAML returns `true`
- `assets/provisioning.yml` installs `graphql-dxm-provider`

## Gotchas

- `ProvisioningManager` is retrieved via `BundleUtils.getOsgiService` — if unavailable, the mutation will throw a NullPointerException rather than returning `false` (the catch block only catches `Exception`, but NPE extends it — so it still returns `false`)
- Invalid YAML causes `ProvisioningManager.executeScript` to throw, which is caught and returns `false` — the client cannot distinguish parse errors from runtime errors
- The mutation is synchronous — long-running scripts will block the GraphQL request thread
