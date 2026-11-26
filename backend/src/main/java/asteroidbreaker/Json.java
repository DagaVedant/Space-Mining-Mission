package asteroidbreaker;

import com.fasterxml.jackson.core.JsonGenerator;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonSerializer;
import com.fasterxml.jackson.databind.SerializerProvider;
import com.fasterxml.jackson.databind.json.JsonMapper;
import com.fasterxml.jackson.databind.module.SimpleModule;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;

/** JSON in and out, shaped like JSON.parse / JSON.stringify. */
final class Json {
    private static final MediaType TYPE = MediaType.parseMediaType("application/json; charset=utf-8");

    /** Decimals stay exact so a save is stored as sent; trailing garbage is an error, as in JSON.parse. */
    static final JsonMapper READER = JsonMapper.builder()
        .enable(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS)
        .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
        .build();

    private static final JsonMapper WRITER = JsonMapper.builder()
        .addModule(new SimpleModule().addSerializer(Double.class, new PlainDouble()))
        .build();

    private Json() {}

    static String write(Object value) {
        try {
            return WRITER.writeValueAsString(value);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException(e);
        }
    }

    /** Ordered object from key, value pairs; null values are kept as JSON null. */
    static Map<String, Object> obj(Object... pairs) {
        Map<String, Object> map = new LinkedHashMap<>();
        for (int i = 0; i < pairs.length; i += 2) map.put((String) pairs[i], pairs[i + 1]);
        return map;
    }

    static ResponseEntity<String> entity(int status, Object body) {
        return raw(status, write(body));
    }

    static ResponseEntity<String> raw(int status, String json) {
        return ResponseEntity.status(status).contentType(TYPE).body(json);
    }

    static void respond(HttpServletResponse response, int status, Object body) throws IOException {
        byte[] bytes = write(body).getBytes(StandardCharsets.UTF_8);
        response.setStatus(status);
        response.setContentType(TYPE.toString());
        response.setContentLength(bytes.length);
        response.getOutputStream().write(bytes);
    }

    /** A double as a plain JSON number: 300 not 300.0, 0.00001 not 1.0E-5, null for NaN and infinity. */
    static String plain(double value) {
        if (!Double.isFinite(value)) return "null";
        if (value == Math.rint(value) && Math.abs(value) < 1e15) return Long.toString((long) value);
        return new BigDecimal(Double.toString(value)).stripTrailingZeros().toPlainString();
    }

    private static final class PlainDouble extends JsonSerializer<Double> {
        @Override
        public void serialize(Double value, JsonGenerator generator, SerializerProvider provider) throws IOException {
            if (Double.isFinite(value)) generator.writeNumber(plain(value));
            else generator.writeNull();
        }
    }
}
