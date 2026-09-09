# graphql-extension-provisioning

Jahia OSGi module that exposes a single GraphQL mutation to execute a Jahia provisioning YAML script provided as a string. No admin UI — pure GraphQL API extension.

## Key Facts

- **artifactId**: `graphql-extension-provisioning` | **version**: `1.1.0-SNAPSHOT`
- **Java package**: `org.jahia.community.graphql.provider.dxm.extensions.provisioning`
- **jahia-depends**: `default,graphql-dxm-provider`
- **No frontend**, no admin UI

## Architecture

| Class | Role |
|-------|------|
| `DXGraphQLExtensionProvisioningProvider` | Registers the mutation extension with the DXM GraphQL provider |
| `ProvisioningMutation` | `@GraphQLTypeExtension(GqlJahiaAdminMutation.class)` — adds the `provisioning` container field |
| `ProvisioningAdminMutation` | The type `provisioning` returns; carries `executeScript` |

## GraphQL API

Extends `GqlJahiaAdminMutation` (accessed via `admin.jahia`):

| Operation | Path | Notes |
|-----------|------|-------|
| Mutation | `admin.jahia.provisioning.executeScript(script: String)` → Boolean | Executes YAML via `ProvisioningManager`; returns `false` on failure |

Permission: `provisioningApi`, checked at the JCR root. Jahia registers privileges by name from the
module's own tree (`/modules/<id>/<version>/permissions/graphql/provisioningApi`); there is no
`/permissions/graphql/provisioningApi` node. Reaching the field also needs the ancestor grants that gate every
admin mutation: `jcr:read` on `/jcr:system` for `admin`, and `graphqlAdminMutation` at `/` for
`admin.jahia`.

```graphql
mutation {
  admin {
    jahia {
      provisioning {
        executeScript(script: "- karafCommand: \"log:log 'test'\"")
      }
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

- Four specs under `tests/cypress/e2e/`: execution, anonymous denial, the permission gate, schema shape
- `assets/provisioning.yml` installs `graphql-dxm-provider` and opens the API security profile for the
  disposable container
- Java unit tests live in `src/test/java` and run with `mvn clean install -DskipTests=false`

## Gotchas

- `ProvisioningManager` is retrieved via `BundleUtils.getOsgiService` on every call. A null service, or a
  lookup that throws, is logged at ERROR and returns `false`
- A failure is signalled by `false`, never by a GraphQL error. The client cannot tell a YAML parse error
  from a runtime one; the distinction is in the server log
- The mutation is synchronous, so a long-running script blocks the GraphQL request thread
- A call that REACHES `ProvisioningManager.executeScript` is audited at INFO with the caller, the
  outcome, and a SHA-256 digest of the script. Both outcomes are covered, success and caught failure.
  The earlier returns are not: a null or blank script, and an unavailable or throwing
  `ProvisioningManager`, log ERROR and emit no audit line. The raw script is never logged, because
  provisioning YAML can carry credentials
- This repo has no CI, so neither test suite runs automatically. Run them by hand and read the
  Cypress summary rather than the exit status: across four local runs on 2026-09-08, `ci.startup.sh`
  returned 0 every time, including one run with 10 failures and two where no test executed. The
  script's last command is `npx @jahia/cypress ci.startup`, so the status comes from that package
  rather than from anything in this repo. See #23
