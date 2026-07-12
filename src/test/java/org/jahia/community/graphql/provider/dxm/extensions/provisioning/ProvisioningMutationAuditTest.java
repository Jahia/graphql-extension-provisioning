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

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import org.jahia.osgi.BundleUtils;
import org.jahia.services.provisioning.ProvisioningManager;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.mockito.MockedStatic;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.List;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockStatic;

/**
 * Audit-logging unit tests for {@link ProvisioningAdminMutation#executeScript(String)} — covers
 * gap-list item U4 (the RCE-equivalent mutation must leave an audit trail of WHO ran a script and
 * WHAT was run) and the accompanying security regression guard (the raw script body — which can
 * carry embedded secrets — must NEVER appear in any log output).
 *
 * <p>Asserts, on BOTH the success and caught-failure paths, that an INFO {@code [audit]} line is
 * emitted naming the calling JCR user and a SHA-256 digest of the script, and that the digest — not
 * the raw content — is what is logged. Mirrors the JUnit-4 / Logback {@link ListAppender} pattern
 * used by {@link ProvisioningMutationLoggingTest}.</p>
 */
public class ProvisioningMutationAuditTest {

    // Deliberately embeds a secret-looking token so the no-raw-leak guard is meaningful: if the
    // implementation ever logged the script body, this marker would surface in the captured output.
    private static final String SECRET_MARKER = "S3CR3T-TOKEN-d0nt-l0g-me";
    private static final String VALID_SCRIPT =
            "- installBundle: \"mvn:org.acme/secure-module/1.0.0?password=" + SECRET_MARKER + "\"";
    private static final String CALLER = "jdoe";

    private Logger mutationLogger;
    private ListAppender<ILoggingEvent> appender;

    @Before
    public void attachAppender() {
        mutationLogger = (Logger) LoggerFactory.getLogger(ProvisioningAdminMutation.class);
        appender = new ListAppender<>();
        appender.start();
        mutationLogger.addAppender(appender);
    }

    @After
    public void detachAppender() {
        if (mutationLogger != null && appender != null) {
            mutationLogger.detachAppender(appender);
        }
    }

    private List<ILoggingEvent> auditEvents() {
        return appender.list.stream()
                .filter(event -> event.getLevel() == Level.INFO)
                .filter(event -> event.getFormattedMessage().startsWith("[audit]"))
                .collect(Collectors.toList());
    }

    private static String expectedDigest() throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        byte[] hash = md.digest(VALID_SCRIPT.getBytes(StandardCharsets.UTF_8));
        StringBuilder hex = new StringBuilder(hash.length * 2);
        for (byte b : hash) {
            hex.append(Character.forDigit((b >> 4) & 0xF, 16));
            hex.append(Character.forDigit(b & 0xF, 16));
        }
        return hex.toString();
    }

    /** Every captured event's formatted message must be free of the raw script body / secret. */
    private void assertNoRawScriptLeaked() {
        for (ILoggingEvent event : appender.list) {
            assertThat(event.getFormattedMessage())
                    .as("no log line may contain the raw script body or its embedded secret")
                    .doesNotContain(SECRET_MARKER)
                    .doesNotContain(VALID_SCRIPT);
        }
    }

    /**
     * Builds a mutation whose caller-identity seam is pinned to {@code userName}, avoiding any need
     * to instrument the {@code JCRSessionFactory}/{@code JahiaUser} type hierarchy — Mockito's
     * inline mock-maker cannot modify either (ByteBuddy "could not instrument all classes").
     */
    private static ProvisioningAdminMutation mutationWithCaller(String userName) {
        return new ProvisioningAdminMutation() {
            @Override
            protected String currentUserName() {
                return userName;
            }
        };
    }

    @Test
    public void executeScript_success_emitsAuditLineWithCallerAndDigest() throws Exception {
        ProvisioningManager manager = mock(ProvisioningManager.class); // executeScript succeeds

        Boolean result;
        try (MockedStatic<BundleUtils> bundleUtils = mockStatic(BundleUtils.class)) {
            bundleUtils.when(() -> BundleUtils.getOsgiService(ProvisioningManager.class, null))
                    .thenReturn(manager);

            result = mutationWithCaller(CALLER).executeScript(VALID_SCRIPT);
        }

        assertThat(result).isTrue();
        List<ILoggingEvent> audits = auditEvents();
        assertThat(audits).hasSize(1);
        assertThat(audits.get(0).getFormattedMessage())
                .contains("outcome=SUCCESS")
                .contains("user=" + CALLER)
                .contains("scriptSha256=" + expectedDigest())
                .contains("scriptLength=" + VALID_SCRIPT.length());
        assertNoRawScriptLeaked();
    }

    @Test
    public void executeScript_runtimeFailure_emitsAuditLineWithFailureOutcome() throws Exception {
        ProvisioningManager manager = mock(ProvisioningManager.class);
        doThrow(new IOException("network down")).when(manager).executeScript(VALID_SCRIPT, "yaml");

        Boolean result;
        try (MockedStatic<BundleUtils> bundleUtils = mockStatic(BundleUtils.class)) {
            bundleUtils.when(() -> BundleUtils.getOsgiService(ProvisioningManager.class, null))
                    .thenReturn(manager);

            result = mutationWithCaller(CALLER).executeScript(VALID_SCRIPT);
        }

        assertThat(result).isFalse();
        List<ILoggingEvent> audits = auditEvents();
        assertThat(audits).hasSize(1);
        assertThat(audits.get(0).getFormattedMessage())
                .contains("outcome=FAILURE")
                .contains("user=" + CALLER)
                .contains("scriptSha256=" + expectedDigest());
        // Security guard: neither the audit line nor the ERROR line may echo the raw script.
        assertNoRawScriptLeaked();
    }

    @Test
    public void executeScript_unresolvableCaller_auditsUnknownUserWithoutFailing() {
        ProvisioningManager manager = mock(ProvisioningManager.class); // succeeds

        Boolean result;
        try (MockedStatic<BundleUtils> bundleUtils = mockStatic(BundleUtils.class)) {
            bundleUtils.when(() -> BundleUtils.getOsgiService(ProvisioningManager.class, null))
                    .thenReturn(manager);

            // Real (non-overridden) mutation: outside a Jahia runtime the JCRSessionFactory
            // singleton yields no current user, so the real currentUserName() fallback fires.
            result = new ProvisioningAdminMutation().executeScript(VALID_SCRIPT);
        }

        assertThat(result).isTrue();
        List<ILoggingEvent> audits = auditEvents();
        assertThat(audits).hasSize(1);
        assertThat(audits.get(0).getFormattedMessage()).contains("user=<unknown>");
        assertNoRawScriptLeaked();
    }
}
