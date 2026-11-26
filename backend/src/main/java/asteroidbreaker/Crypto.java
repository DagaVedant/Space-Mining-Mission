package asteroidbreaker;

import java.nio.ByteBuffer;
import java.nio.CharBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.HexFormat;
import java.util.concurrent.Semaphore;
import org.bouncycastle.crypto.generators.SCrypt;

/** Passwords, tokens and ids, byte for byte what the Node backend stored. */
final class Crypto {
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final HexFormat HEX = HexFormat.of();
    // Node encodes a lone surrogate as U+FFFD; Java's default would write '?'
    private static final byte[] REPLACEMENT = {(byte) 0xEF, (byte) 0xBF, (byte) 0xBD};
    // each scrypt call needs about 16 MB, which matters on a 512 MB instance
    private static final Semaphore SCRYPT_SLOTS = new Semaphore(2);

    private Crypto() {}

    static String randomHex(int bytes) {
        byte[] data = new byte[bytes];
        RANDOM.nextBytes(data);
        return HEX.formatHex(data);
    }

    static String randomToken() {
        byte[] data = new byte[32];
        RANDOM.nextBytes(data);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(data);
    }

    static String sha256Hex(String value) {
        try {
            return HEX.formatHex(MessageDigest.getInstance("SHA-256").digest(utf8(value)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    static byte[] scrypt(byte[] password, byte[] salt, int n, int r, int p, int length) {
        SCRYPT_SLOTS.acquireUninterruptibly();
        try {
            return SCrypt.generate(password, salt, n, r, p, length);
        } finally {
            SCRYPT_SLOTS.release();
        }
    }

    /** scryptSync(password, salt, 64): N=16384, r=8, p=1, the salt string used as its own UTF-8 bytes. */
    static String hashPassword(String password, String salt) {
        return HEX.formatHex(scrypt(utf8(password), utf8(salt), 16384, 8, 1, 64));
    }

    static boolean verifyPassword(String password, String salt, String expectedHex) {
        byte[] expected;
        try {
            expected = HEX.parseHex(expectedHex);
        } catch (IllegalArgumentException e) {
            return false;
        }
        byte[] candidate = scrypt(utf8(password), utf8(salt), 16384, 8, 1, 64);
        return MessageDigest.isEqual(candidate, expected);
    }

    static byte[] utf8(String value) {
        try {
            ByteBuffer encoded = StandardCharsets.UTF_8.newEncoder()
                .onMalformedInput(CodingErrorAction.REPLACE)
                .onUnmappableCharacter(CodingErrorAction.REPLACE)
                .replaceWith(REPLACEMENT)
                .encode(CharBuffer.wrap(value));
            byte[] bytes = new byte[encoded.remaining()];
            encoded.get(bytes);
            return bytes;
        } catch (CharacterCodingException e) {
            throw new IllegalStateException(e);
        }
    }
}
