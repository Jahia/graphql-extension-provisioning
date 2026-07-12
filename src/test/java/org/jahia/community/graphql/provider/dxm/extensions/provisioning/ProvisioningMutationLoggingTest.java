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
import java.util.List;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockStatic;

/**
 * Log-capture unit tests for {@link ProvisioningAdminMutation#executeScript(String)} — covers
 * gap-list item U3 (distinct ERROR messages for parse vs runtime failures) and the D3 mechanism
 * pin (service-unavailable ERROR emitted WITHOUT a throwable, proving the explicit null-check
 * branch rather than a swallowed NPE).
 *
 * <p>Uses JUnit 4 ({@code org.junit.Test}) because the jahia-modules parent pins the
 * surefire-junit4 provider; a JUnit 5 test would compile but silently run 0 tests.</p>
 *
 * <p>The module ships no SLF4J binding; a test-scope Logback binding (see pom.xml) lets us attach
 * a {@link ListAppender} to the {@code ProvisioningAdminMutation} logger and inspect the emitted
 * events (formatted message + presence/absence of an attached throwable).</p>
 */
public class ProvisioningMutationLoggingTest {

    private static final String VALID_SCRIPT = "- karafCommand: \"log:log 'test'\"";

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

    private List<ILoggingEvent> errorEvents() {
        return appender.list.stream()
                .filter(event -> event.getLevel() == Level.ERROR)
                .collect(Collectors.toList());
    }

    @Test
    public void executeScript_invalidYaml_logsDistinctParseFailureAtError() throws Exception {
        ProvisioningManager manager = mock(ProvisioningManager.class);
        doThrow(new IllegalArgumentException("bad yaml"))
                .when(manager).executeScript(VALID_SCRIPT, "yaml");

        Boolean result;
        try (MockedStatic<BundleUtils> bundleUtils = mockStatic(BundleUtils.class)) {
            bundleUtils.when(() -> BundleUtils.getOsgiService(ProvisioningManager.class, null))
                    .thenReturn(manager);

            result = new ProvisioningAdminMutation().executeScript(VALID_SCRIPT);
        }

        assertThat(result).isFalse();
        List<ILoggingEvent> errors = errorEvents();
        assertThat(errors).hasSize(1);
        assertThat(errors.get(0).getFormattedMessage())
                .contains("failed YAML parse/validation")
                .doesNotContain("execution failed at runtime");
    }

    @Test
    public void executeScript_runtimeFailure_logsDistinctRuntimeMessageAtError() throws Exception {
        ProvisioningManager manager = mock(ProvisioningManager.class);
        doThrow(new IOException("network down"))
                .when(manager).executeScript(VALID_SCRIPT, "yaml");

        Boolean result;
        try (MockedStatic<BundleUtils> bundleUtils = mockStatic(BundleUtils.class)) {
            bundleUtils.when(() -> BundleUtils.getOsgiService(ProvisioningManager.class, null))
                    .thenReturn(manager);

            result = new ProvisioningAdminMutation().executeScript(VALID_SCRIPT);
        }

        assertThat(result).isFalse();
        List<ILoggingEvent> errors = errorEvents();
        assertThat(errors).hasSize(1);
        assertThat(errors.get(0).getFormattedMessage())
                .contains("execution failed at runtime")
                .doesNotContain("failed YAML parse/validation");
    }

    @Test
    public void executeScript_parseAndRuntimeFailures_emitDifferentErrorMessages() throws Exception {
        ProvisioningManager parseFailureManager = mock(ProvisioningManager.class);
        doThrow(new IllegalArgumentException("bad yaml"))
                .when(parseFailureManager).executeScript(VALID_SCRIPT, "yaml");
        ProvisioningManager runtimeFailureManager = mock(ProvisioningManager.class);
        doThrow(new IOException("network down"))
                .when(runtimeFailureManager).executeScript(VALID_SCRIPT, "yaml");

        String parseMessage;
        String runtimeMessage;
        try (MockedStatic<BundleUtils> bundleUtils = mockStatic(BundleUtils.class)) {
            bundleUtils.when(() -> BundleUtils.getOsgiService(ProvisioningManager.class, null))
                    .thenReturn(parseFailureManager);
            new ProvisioningAdminMutation().executeScript(VALID_SCRIPT);
            parseMessage = errorEvents().get(0).getFormattedMessage();

            appender.list.clear();

            bundleUtils.when(() -> BundleUtils.getOsgiService(ProvisioningManager.class, null))
                    .thenReturn(runtimeFailureManager);
            new ProvisioningAdminMutation().executeScript(VALID_SCRIPT);
            runtimeMessage = errorEvents().get(0).getFormattedMessage();
        }

        // The whole point of U3: parse vs runtime failures are distinguishable in server logs.
        assertThat(parseMessage).isNotEqualTo(runtimeMessage);
    }

    /**
     * D3 mechanism pin: a null {@code ProvisioningManager} is handled by the explicit
     * {@code if (provisioningManager == null)} branch, which logs the service-unavailable ERROR
     * WITHOUT an attached throwable. The AGENTS.md-described regression shape (no null-check; NPE
     * thrown then swallowed by the generic {@code catch (Exception)}) would instead emit the
     * runtime-failure message WITH a {@link Throwable} attached — so asserting both the message
     * and the absence of a throwable distinguishes the two mechanisms, which the return value
     * ({@code false} in either case) cannot.
     */
    @Test
    public void executeScript_serviceUnavailable_logsUnavailableErrorWithoutThrowable() {
        Boolean result;
        try (MockedStatic<BundleUtils> bundleUtils = mockStatic(BundleUtils.class)) {
            bundleUtils.when(() -> BundleUtils.getOsgiService(ProvisioningManager.class, null))
                    .thenReturn(null);

            result = new ProvisioningAdminMutation().executeScript(VALID_SCRIPT);
        }

        assertThat(result).isFalse();
        List<ILoggingEvent> errors = errorEvents();
        assertThat(errors).hasSize(1);
        ILoggingEvent event = errors.get(0);
        assertThat(event.getFormattedMessage())
                .contains("OSGi service is unavailable")
                .doesNotContain("execution failed at runtime");
        assertThat(event.getThrowableProxy())
                .as("service-unavailable branch must not carry a throwable (no NPE swallowed)")
                .isNull();
    }
}
