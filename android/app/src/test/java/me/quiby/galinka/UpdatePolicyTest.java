package me.quiby.galinka;

import static org.junit.Assert.*;
import org.junit.Test;

public class UpdatePolicyTest {
    private static final String APK = "https://github.com/cl0rex1/Galinka/releases/download/v0.5.0/Galinka-0.5.0-android-release.apk";

    @Test
    public void downloadsRequireOurReleaseAndHttpsArtifactRedirects() {
        assertTrue(UpdatePolicy.allowedUrl(APK, true));
        assertTrue(UpdatePolicy.allowedUrl("https://release-assets.githubusercontent.com/github-production-release-asset/file?token=signed", false));
        assertFalse(UpdatePolicy.allowedUrl("https://release-assets.githubusercontent.com/file", true));
        for (String url : new String[] {
            APK.replace("https:", "http:"), APK.replace("Galinka/releases", "Other/releases"),
            APK.replace("github.com/", "github.com.evil.example/"), APK.replace("github.com/", "github.com@localhost/"),
            APK.replace("github.com/", "github.com:8443/"), APK + "#fragment", APK + "?redirect=1",
            "http://127.0.0.1/private.apk", "file:///private.apk", "https://localhost/private.apk"
        }) assertFalse(url, UpdatePolicy.allowedUrl(url, true));
        assertFalse(UpdatePolicy.allowedUrl("https://evil.example/file.apk", false));
        assertFalse(UpdatePolicy.allowedUrl("https://release-assets.githubusercontent.com.evil.example/file.apk", false));
    }

    @Test
    public void updateMustHaveSamePackageExactCurrentSignersAndNewerExpectedVersion() {
        byte[][] signer = { { 1, 2, 3 } };
        UpdatePolicy.validateCandidate("me.quiby.galinka", 4001, signer, "me.quiby.galinka", 5000, signer, "0.5.0", "0.5.0");
        assertThrows(SecurityException.class, () -> UpdatePolicy.validateCandidate("me.quiby.galinka", 4001, signer, "other.app", 5000, signer, "0.5.0", "0.5.0"));
        assertThrows(SecurityException.class, () -> UpdatePolicy.validateCandidate("me.quiby.galinka", 5000, signer, "me.quiby.galinka", 5000, signer, "0.5.0", "0.5.0"));
        assertThrows(SecurityException.class, () -> UpdatePolicy.validateCandidate("me.quiby.galinka", 5001, signer, "me.quiby.galinka", 5000, signer, "0.5.0", "0.5.0"));
        assertThrows(SecurityException.class, () -> UpdatePolicy.validateCandidate("me.quiby.galinka", 4001, signer, "me.quiby.galinka", 5000, new byte[][] {{9}}, "0.5.0", "0.5.0"));
        assertThrows(SecurityException.class, () -> UpdatePolicy.validateCandidate("me.quiby.galinka", 4001, signer, "me.quiby.galinka", 5000, signer, "0.5.1", "0.5.0"));
        assertFalse(UpdatePolicy.sameSigners(signer, null));
        assertFalse(UpdatePolicy.sameSigners(new byte[0][], new byte[0][]));
        assertFalse(UpdatePolicy.sameSigners(signer, new byte[][] {{1, 2, 3}, {4}}));
        assertTrue(UpdatePolicy.sameSigners(new byte[][] {{1}, {2}}, new byte[][] {{2}, {1}}));
    }
}
