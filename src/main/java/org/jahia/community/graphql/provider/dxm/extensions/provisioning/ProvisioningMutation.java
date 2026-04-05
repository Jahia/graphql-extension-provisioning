package org.jahia.community.graphql.provider.dxm.extensions.provisioning;

import graphql.annotations.annotationTypes.GraphQLDescription;
import graphql.annotations.annotationTypes.GraphQLField;
import graphql.annotations.annotationTypes.GraphQLName;
import graphql.annotations.annotationTypes.GraphQLTypeExtension;
import org.jahia.modules.graphql.provider.dxm.admin.GqlJahiaAdminMutation;
import org.jahia.modules.graphql.provider.dxm.security.GraphQLRequiresPermission;
import org.jahia.osgi.BundleUtils;
import org.jahia.services.provisioning.ProvisioningManager;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

@GraphQLTypeExtension(GqlJahiaAdminMutation.class)
public class ProvisioningMutation {

    private static final Logger LOGGER = LoggerFactory.getLogger(ProvisioningMutation.class);

    @GraphQLField
    @GraphQLDescription("Execute a YAML provisioning script provided as a string")
    @GraphQLRequiresPermission("provisioningApi")
    public static Boolean executeScript(
            @GraphQLName("script") @GraphQLDescription("YAML provisioning script content") String script
    ) {
        try {
            final ProvisioningManager provisioningManager = BundleUtils.getOsgiService(ProvisioningManager.class, null);
            provisioningManager.executeScript(script, "yaml");
            return Boolean.TRUE;
        } catch (Exception ex) {
            LOGGER.error("Error executing provisioning script", ex);
            return Boolean.FALSE;
        }
    }
}
