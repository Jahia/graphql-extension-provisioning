/*
 * MIT License
 *
 * Copyright (c) 2026 - present Florent BOURASSÉ
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
package org.jahia.community.graphql.provider.dxm.extensions.provisioning;

import graphql.annotations.annotationTypes.GraphQLDescription;
import graphql.annotations.annotationTypes.GraphQLField;
import graphql.annotations.annotationTypes.GraphQLName;
import org.jahia.modules.graphql.provider.dxm.security.GraphQLRequiresPermission;
import org.jahia.osgi.BundleUtils;
import org.jahia.services.content.JCRSessionFactory;
import org.jahia.services.provisioning.ProvisioningManager;
import org.jahia.services.usermanager.JahiaUser;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

@GraphQLName("ProvisioningAdminMutation")
@GraphQLDescription("Provisioning administrative mutations")
public class ProvisioningAdminMutation {

    private static final Logger LOGGER = LoggerFactory.getLogger(ProvisioningAdminMutation.class);

    /** Format identifier passed to {@link ProvisioningManager#executeScript(String, String)}. */
    private static final String SCRIPT_FORMAT_YAML = "yaml";

    /** Placeholder used when the calling user cannot be resolved from the current JCR session. */
    private static final String UNKNOWN_USER = "<unknown>";

    /**
     * Executes a Jahia provisioning script supplied as a YAML string.
     *
     * <p>The {@code script} parameter must contain a valid Jahia provisioning YAML document
     * (e.g. {@code - installBundle: "mvn:org.jahia.modules/article/3.2.0"}).
     * Refer to the Jahia Provisioning API documentation for the full list of supported
     * operations.</p>
     *
     * <p><strong>Returns:</strong></p>
     * <ul>
     *   <li>{@code true} — the script was parsed and executed without error.</li>
     *   <li>{@code false} — one of the following failure conditions occurred:
     *     <ul>
     *       <li>The {@code script} argument is {@code null} or blank.</li>
     *       <li>The {@code ProvisioningManager} OSGi service could not be retrieved
     *           (service unavailable or framework not ready).</li>
     *       <li>The YAML could not be parsed ({@link IllegalArgumentException}).</li>
     *       <li>Execution failed at runtime (any other {@link Exception}).</li>
     *     </ul>
     *     All failure paths are logged at ERROR level before returning {@code false}.
     *   </li>
     * </ul>
     *
     * <p><strong>Required permission:</strong> {@code provisioningApi}
     * (JCR path {@code /permissions/graphql/provisioningApi}).
     * This permission is shipped by the module itself via its JCR import and is
     * automatically created on first deployment.</p>
     *
     * <p><strong>Threading note:</strong> this method is synchronous. Long-running
     * provisioning scripts will block the GraphQL request thread for their full
     * duration.</p>
     *
     * @param script the YAML provisioning script content; must not be {@code null} or blank
     * @return {@code true} on success, {@code false} on any failure
     */
    @GraphQLField
    @GraphQLDescription("Execute a YAML provisioning script provided as a string")
    @GraphQLRequiresPermission("provisioningApi")
    public Boolean executeScript(
            @GraphQLName("script") @GraphQLDescription("YAML provisioning script content") String script
    ) {
        if (script == null || script.trim().isEmpty()) {
            LOGGER.error("Provisioning script is null or blank; nothing to execute");
            return Boolean.FALSE;
        }
        final ProvisioningManager provisioningManager;
        try {
            provisioningManager = BundleUtils.getOsgiService(ProvisioningManager.class, null);
        } catch (Exception ex) {
            LOGGER.error("Failed to retrieve ProvisioningManager OSGi service", ex);
            return Boolean.FALSE;
        }
        if (provisioningManager == null) {
            LOGGER.error("ProvisioningManager OSGi service is unavailable; cannot execute provisioning script");
            return Boolean.FALSE;
        }
        try {
            provisioningManager.executeScript(script, SCRIPT_FORMAT_YAML);
            audit("SUCCESS", script);
            return Boolean.TRUE;
        } catch (IllegalArgumentException ex) {
            audit("FAILURE", script);
            LOGGER.error("Provisioning script failed YAML parse/validation: {}", ex.getMessage(), ex);
            return Boolean.FALSE;
        } catch (Exception ex) {
            audit("FAILURE", script);
            LOGGER.error("Provisioning script execution failed at runtime", ex);
            return Boolean.FALSE;
        }
    }

    /**
     * Emits a single INFO-level audit line recording <em>who</em> invoked the RCE-equivalent
     * {@code executeScript} mutation, the <em>outcome</em>, and a content-addressable fingerprint
     * of the script — so that after an incident it is possible to establish which caller ran a
     * given script, on both the success and the caught-failure paths.
     *
     * <p><strong>Security:</strong> the raw script body is deliberately <em>never</em> logged.
     * Provisioning YAML can embed credentials, tokens, and other secrets; logging it verbatim
     * would leak them into server logs. Instead a SHA-256 digest (plus the length) is emitted,
     * which is enough to correlate two executions of the same script without disclosing its
     * contents.</p>
     *
     * @param outcome {@code "SUCCESS"} or {@code "FAILURE"}
     * @param script  the (non-null, non-blank) script that was submitted; only its digest/length
     *                are logged, never its contents
     */
    private void audit(String outcome, String script) {
        LOGGER.info("[audit] executeScript outcome={} user={} scriptSha256={} scriptLength={}",
                outcome, currentUserName(), sha256Hex(script), script.length());
    }

    /**
     * Resolves the authenticated GraphQL caller's name from the same {@link JCRSessionFactory}
     * thread-local that the {@code @GraphQLRequiresPermission} gate checked, so the audit line
     * names the caller. Falls back to {@value #UNKNOWN_USER} if the user cannot be resolved —
     * auditing must never break the mutation.
     *
     * <p>Extracted as an overridable seam so the audit behaviour can be unit-tested without
     * instrumenting the {@code JCRSessionFactory} singleton (whose wide interface hierarchy defeats
     * Mockito's inline mock-maker).</p>
     */
    protected String currentUserName() {
        try {
            JahiaUser user = JCRSessionFactory.getInstance().getCurrentUser();
            return (user != null && user.getName() != null) ? user.getName() : UNKNOWN_USER;
        } catch (Exception ex) {
            return UNKNOWN_USER;
        }
    }

    /** Computes the lowercase hex SHA-256 digest of the script for correlation without disclosure. */
    private static String sha256Hex(String script) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(script.getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder(hash.length * 2);
            for (byte b : hash) {
                hex.append(Character.forDigit((b >> 4) & 0xF, 16));
                hex.append(Character.forDigit(b & 0xF, 16));
            }
            return hex.toString();
        } catch (NoSuchAlgorithmException ex) {
            // SHA-256 is a mandatory JCA algorithm; unreachable in practice.
            return "unavailable";
        }
    }
}
