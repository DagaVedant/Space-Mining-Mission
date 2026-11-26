package asteroidbreaker;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.charset.StandardCharsets;
import java.util.HexFormat;
import org.junit.jupiter.api.Test;

class CryptoTest {
    private static String scrypt(String password, String salt, int n, int r, int p) {
        byte[] key = Crypto.scrypt(password.getBytes(StandardCharsets.UTF_8), salt.getBytes(StandardCharsets.UTF_8), n, r, p, 64);
        return HexFormat.of().formatHex(key);
    }

    // RFC 7914, section 12
    @Test
    void scryptMatchesRfc7914Vectors() {
        assertEquals(
            "77d6576238657b203b19ca42c18a0497f16b4844e3074ae8dfdffa3fede21442"
                + "fcd0069ded0948f8326a753a0fc81f17e8d3e0fb2e0d3628cf35e20c38d18906",
            scrypt("", "", 16, 1, 1));
        assertEquals(
            "fdbabe1c9d3472007856e7190d01e9fe7c6ad7cbc8237830e77376634b373162"
                + "2eaf30d92e22a3886ff109279d9830dac727afb94a83ee6d8360cbdfa2cc0640",
            scrypt("password", "NaCl", 1024, 8, 16));
    }

    @Test
    void passwordsVerifyWithTheStoredSaltAndHash() {
        String salt = Crypto.randomHex(16);
        assertEquals(32, salt.length());
        String hash = Crypto.hashPassword("space-rocks-safe-2026", salt);
        assertEquals(128, hash.length());
        assertTrue(Crypto.verifyPassword("space-rocks-safe-2026", salt, hash));
        assertFalse(Crypto.verifyPassword("space-rocks-safe-2027", salt, hash));
        assertFalse(Crypto.verifyPassword("space-rocks-safe-2026", salt, "not hex"));
    }

    @Test
    void saltIsUsedAsItsUtf8BytesNotHexDecoded() {
        String salt = "00ff00ff00ff00ff00ff00ff00ff00ff";
        byte[] expected = Crypto.scrypt("pw-for-salt-test".getBytes(StandardCharsets.UTF_8), salt.getBytes(StandardCharsets.UTF_8), 16384, 8, 1, 64);
        assertEquals(HexFormat.of().formatHex(expected), Crypto.hashPassword("pw-for-salt-test", salt));
    }

    @Test
    void loneSurrogatesEncodeAsReplacementCharacter() {
        assertEquals("efbfbd61", HexFormat.of().formatHex(Crypto.utf8("\ud800a")));
    }
}
