package me.quiby.galinka;

import java.net.URI;
import java.security.MessageDigest;
import java.util.Arrays;

final class UpdatePolicy {
    static final long MAX_BYTES = 250L * 1024 * 1024;
    private UpdatePolicy() {}

    static boolean allowedUrl(String value, boolean initial) {
        if (value == null || value.length() > 8192) return false;
        try {
            URI uri = new URI(value);
            if (!"https".equals(uri.getScheme()) || uri.getRawUserInfo() != null
                    || uri.getFragment() != null || (uri.getPort() != -1 && uri.getPort() != 443)) return false;
            if ("github.com".equals(uri.getHost())) {
                String path = uri.getPath();
                return path != null && path.startsWith("/cl0rex1/Galinka/releases/download/")
                        && path.endsWith("-android-release.apk") && (!initial || uri.getRawQuery() == null);
            }
            return !initial && ("release-assets.githubusercontent.com".equals(uri.getHost())
                    || "objects.githubusercontent.com".equals(uri.getHost())
                    || "github-releases.githubusercontent.com".equals(uri.getHost()));
        } catch (Exception ignored) { return false; }
    }

    static void validateCandidate(String installedPackage, long installedVersion, byte[][] installedSigners,
            String candidatePackage, long candidateVersion, byte[][] candidateSigners,
            String expectedVersion, String candidateVersionName) throws SecurityException {
        if (!installedPackage.equals(candidatePackage)) throw new SecurityException("Wrong package");
        if (candidateVersion <= installedVersion) throw new SecurityException("Update must be newer");
        if (expectedVersion == null || !expectedVersion.matches("\\d+\\.\\d+\\.\\d+")
                || !expectedVersion.equals(candidateVersionName)) throw new SecurityException("Wrong version");
        if (!sameSigners(installedSigners, candidateSigners)) throw new SecurityException("Wrong signing certificate");
    }

    static boolean sameSigners(byte[][] installed, byte[][] candidate) {
        if (installed == null || candidate == null || installed.length == 0 || installed.length != candidate.length) return false;
        try {
            String[] left = signerDigests(installed), right = signerDigests(candidate);
            Arrays.sort(left);
            Arrays.sort(right);
            return Arrays.equals(left, right);
        } catch (Exception ignored) { return false; }
    }

    private static String[] signerDigests(byte[][] signatures) throws Exception {
        String[] result = new String[signatures.length];
        for (int i = 0; i < signatures.length; i++) {
            byte[] hash = MessageDigest.getInstance("SHA-256").digest(signatures[i]);
            StringBuilder hex = new StringBuilder();
            for (byte value : hash) hex.append(String.format("%02x", value & 0xff));
            result[i] = hex.toString();
        }
        return result;
    }
}
