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

import org.jahia.osgi.BundleUtils;
import org.jahia.services.provisioning.ProvisioningManager;
import org.junit.Test;
import org.mockito.MockedStatic;

import java.io.IOException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockStatic;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoMoreInteractions;

/**
 * Unit tests for {@link ProvisioningAdminMutation#executeScript(String)}.
 *
 * <p>Uses JUnit 4 ({@code org.junit.Test}) because the jahia-modules parent pins the
 * surefire-junit4 provider; a JUnit 5 test would compile but silently run 0 tests.</p>
 */
public class ProvisioningMutationTest {

    private static final String VALID_SCRIPT = "- karafCommand: \"log:log 'test'\"";

    private static final String MULTI_STEP_SCRIPT =
            "- karafCommand: \"log:log 'step 1'\"\n- karafCommand: \"log:log 'step 2'\"";

    @Test
    public void executeScript_nullScript_returnsFalseWithoutTouchingService() {
        try (MockedStatic<BundleUtils> bundleUtils = mockStatic(BundleUtils.class)) {
            Boolean result = new ProvisioningAdminMutation().executeScript(null);

            assertThat(result).isFalse();
            // Validation short-circuits before any OSGi lookup.
            bundleUtils.verifyNoInteractions();
        }
    }

    @Test
    public void executeScript_blankScript_returnsFalseWithoutTouchingService() {
        try (MockedStatic<BundleUtils> bundleUtils = mockStatic(BundleUtils.class)) {
            Boolean result = new ProvisioningAdminMutation().executeScript("   \n\t ");

            assertThat(result).isFalse();
            bundleUtils.verifyNoInteractions();
        }
    }

    @Test
    public void executeScript_emptyStringScript_returnsFalseWithoutTouchingService() {
        try (MockedStatic<BundleUtils> bundleUtils = mockStatic(BundleUtils.class)) {
            Boolean result = new ProvisioningAdminMutation().executeScript("");

            assertThat(result).isFalse();
            bundleUtils.verifyNoInteractions();
        }
    }

    @Test
    public void executeScript_unavailableProvisioningManager_returnsFalse() {
        try (MockedStatic<BundleUtils> bundleUtils = mockStatic(BundleUtils.class)) {
            bundleUtils.when(() -> BundleUtils.getOsgiService(ProvisioningManager.class, null))
                    .thenReturn(null);

            Boolean result = new ProvisioningAdminMutation().executeScript(VALID_SCRIPT);

            assertThat(result).isFalse();
        }
    }

    @Test
    public void executeScript_osgiLookupThrows_returnsFalse() {
        try (MockedStatic<BundleUtils> bundleUtils = mockStatic(BundleUtils.class)) {
            bundleUtils.when(() -> BundleUtils.getOsgiService(ProvisioningManager.class, null))
                    .thenThrow(new RuntimeException("OSGi framework not ready"));

            Boolean result = new ProvisioningAdminMutation().executeScript(VALID_SCRIPT);

            assertThat(result).isFalse();
        }
    }

    @Test
    public void executeScript_validScript_executesAsYamlAndReturnsTrue() throws Exception {
        ProvisioningManager manager = mock(ProvisioningManager.class);
        doNothing().when(manager).executeScript(VALID_SCRIPT, "yaml");

        try (MockedStatic<BundleUtils> bundleUtils = mockStatic(BundleUtils.class)) {
            bundleUtils.when(() -> BundleUtils.getOsgiService(ProvisioningManager.class, null))
                    .thenReturn(manager);

            Boolean result = new ProvisioningAdminMutation().executeScript(VALID_SCRIPT);

            assertThat(result).isTrue();
            verify(manager).executeScript(VALID_SCRIPT, "yaml");
        }
    }

    @Test
    public void executeScript_invalidYaml_returnsFalseAndDoesNotSwallowSilently() throws Exception {
        ProvisioningManager manager = mock(ProvisioningManager.class);
        doThrow(new IllegalArgumentException("bad yaml"))
                .when(manager).executeScript(any(String.class), any(String.class));

        try (MockedStatic<BundleUtils> bundleUtils = mockStatic(BundleUtils.class)) {
            bundleUtils.when(() -> BundleUtils.getOsgiService(ProvisioningManager.class, null))
                    .thenReturn(manager);

            Boolean result = new ProvisioningAdminMutation().executeScript(VALID_SCRIPT);

            assertThat(result).isFalse();
        }
    }

    @Test
    public void executeScript_runtimeIoFailure_returnsFalse() throws Exception {
        ProvisioningManager manager = mock(ProvisioningManager.class);
        doThrow(new IOException("network down"))
                .when(manager).executeScript(any(String.class), any(String.class));

        try (MockedStatic<BundleUtils> bundleUtils = mockStatic(BundleUtils.class)) {
            bundleUtils.when(() -> BundleUtils.getOsgiService(ProvisioningManager.class, null))
                    .thenReturn(manager);

            Boolean result = new ProvisioningAdminMutation().executeScript(VALID_SCRIPT);

            assertThat(result).isFalse();
        }
    }

    @Test
    public void executeScript_blankScript_neverInvokesProvisioningManager() throws Exception {
        ProvisioningManager manager = mock(ProvisioningManager.class);

        try (MockedStatic<BundleUtils> bundleUtils = mockStatic(BundleUtils.class)) {
            bundleUtils.when(() -> BundleUtils.getOsgiService(ProvisioningManager.class, null))
                    .thenReturn(manager);

            new ProvisioningAdminMutation().executeScript("");

            verify(manager, never()).executeScript(any(String.class), any(String.class));
        }
    }

    @Test
    public void executeScript_multiStepScriptFails_delegatesOnceWithNoRetryOrRollback() throws Exception {
        // U9: `true` means "no exception thrown"; on a partial multi-step failure the module
        // performs exactly ONE delegation to ProvisioningManager — no retry, no compensation /
        // rollback call, no per-step inspection (the void executeScript gives it nothing to inspect).
        ProvisioningManager manager = mock(ProvisioningManager.class);
        doThrow(new IOException("step 2 failed"))
                .when(manager).executeScript(MULTI_STEP_SCRIPT, "yaml");

        try (MockedStatic<BundleUtils> bundleUtils = mockStatic(BundleUtils.class)) {
            bundleUtils.when(() -> BundleUtils.getOsgiService(ProvisioningManager.class, null))
                    .thenReturn(manager);

            Boolean result = new ProvisioningAdminMutation().executeScript(MULTI_STEP_SCRIPT);

            assertThat(result).isFalse();
            verify(manager, times(1)).executeScript(MULTI_STEP_SCRIPT, "yaml");
            verifyNoMoreInteractions(manager);
        }
    }
}
