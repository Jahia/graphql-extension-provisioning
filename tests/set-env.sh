#!/bin/bash

if [[ -f .env ]]; then
  source .env
  export $(cat .env | sed 's/=.*//g'| xargs)
else
  source .env.example
  export $(cat .env.example | sed 's/=.*//g'| xargs)
fi
JAHIA_VERSION=${JAHIA_VERSION:-LATEST}
JAHIA_IMAGE=${JAHIA_IMAGE:-ghcr.io/jahia/jahia-ee-dev:8-SNAPSHOT}
TESTS_IMAGE=${TESTS_IMAGE:-jahia/graphql-extension-provisioning:latest}
MODULE_ID=${MODULE_ID:-graphql-extension-provisioning}
MANIFEST=${MANIFEST:-provisioning-manifest-snapshot.yml}
JAHIA_URL=${JAHIA_URL:-http://jahia:8080}
if [[ -z "${SUPER_USER_PASSWORD}" ]]; then
  echo "ERROR: SUPER_USER_PASSWORD environment variable is not set. Set it before running tests." >&2
  exit 1
fi
JAHIA_LICENSE=${JAHIA_LICENSE:-""}
JAHIA_HOST=${JAHIA_HOST:-jahia}
