package me.quiby.galinka;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.os.Build;
import java.io.File;

final class ApkVerifier {
    private ApkVerifier() {}

    @SuppressWarnings("deprecation")
    static void verify(Context context, File file, String expectedVersion) throws Exception {
        if (!file.isFile() || file.length() == 0 || file.length() > UpdatePolicy.MAX_BYTES)
            throw new SecurityException("Invalid APK size");
        PackageManager manager = context.getPackageManager();
        int flags = Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
        PackageInfo installed = manager.getPackageInfo(context.getPackageName(), flags);
        PackageInfo candidate = manager.getPackageArchiveInfo(file.getAbsolutePath(), flags);
        if (candidate == null) throw new SecurityException("Invalid APK");
        UpdatePolicy.validateCandidate(installed.packageName, versionCode(installed), signers(installed),
                candidate.packageName, versionCode(candidate), signers(candidate), expectedVersion, candidate.versionName);
    }

    @SuppressWarnings("deprecation")
    private static long versionCode(PackageInfo info) {
        return Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode;
    }

    @SuppressWarnings("deprecation")
    private static byte[][] signers(PackageInfo info) {
        Signature[] signatures = Build.VERSION.SDK_INT >= 28
                ? (info.signingInfo == null ? null : info.signingInfo.getApkContentsSigners()) : info.signatures;
        if (signatures == null) return null;
        byte[][] bytes = new byte[signatures.length][];
        for (int i = 0; i < signatures.length; i++) bytes[i] = signatures[i].toByteArray();
        return bytes;
    }
}
