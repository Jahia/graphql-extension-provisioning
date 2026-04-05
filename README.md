# Jahia GraphQL Extension Provisioning

The purpose of this module is to expose the Jahia Provisioning API through GraphQL mutations, allowing the execution of YAML provisioning scripts directly via GraphQL queries.

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

#### Execute a provisioning script from a file
Provide the absolute path to a YAML provisioning script file on the server:
```graphql
mutation {
    admin {
        jahia {
            executeScriptFromFile(filePath: "/path/to/provisioning-script.yaml")
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
