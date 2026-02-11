# Evren API — Specification for Implementers

This document describes the HTTP API that the **Evren** model service must expose so the Maibel evaluation app can run test cases and record responses. Implement this API on your Evren backend so the eval app can call it.

---

## Base URL

- Configurable in the eval app (e.g. `http://localhost:8000` or your deployed Evren service URL).
- The eval app will **always call the path `/evren`**. If the base URL does not end with `/evren`, the app appends it.
- **Example**: If base URL is `http://localhost:8000`, the app sends requests to `http://localhost:8000/evren`.

---

## Endpoint

### `POST /evren`

Processes one user input (and optional image/context) and returns Evren’s reply plus any detected flags.

#### Request

- **Method**: `POST`
- **Headers**: `Content-Type: application/json`
- **Body**: JSON object with the following fields.

| Field            | Type   | Required | Description |
|------------------|--------|----------|-------------|
| `input_message`  | string | **Yes**  | The user message / prompt for Evren. |
| `img_url`        | string | No       | Optional URL of an image (e.g. user-uploaded). |
| `context`        | object | No       | Optional context. If the eval app has JSON, it sends it as an object; otherwise it sends `{ "description": "<string>" }`. |

**Example request body:**

```json
{
  "input_message": "I've been feeling really anxious lately and can't sleep.",
  "img_url": "https://example.com/some-image.png",
  "context": {
    "description": "User has mentioned sleep issues in previous messages."
  }
}
```

Minimal request (no image, no context):

```json
{
  "input_message": "Hey, how are you?"
}
```

#### Response

- **Status**: `200 OK` on success. Any non-2xx status is treated as an error by the eval app.
- **Headers**: `Content-Type: application/json` (recommended).
- **Body**: JSON object with exactly these two fields (both strings):

| Field             | Type   | Required | Description |
|-------------------|--------|----------|-------------|
| `evren_response`  | string | **Yes**  | Evren’s reply to the user (full text). |
| `detected_flags`  | string | **Yes**  | Comma-separated or otherwise formatted list of flags that Evren detected for this input (e.g. `"P0_CRISIS, SAFE"` or `""` if none). |

**Example response body:**

```json
{
  "evren_response": "I hear you — that sounds really tough. When did the anxiety around sleep start feeling this intense?",
  "detected_flags": "SAFE, P1_DISTRESS"
}
```

If no flags are detected:

```json
{
  "evren_response": "Hey! I'm doing okay, thanks for asking. How about you?",
  "detected_flags": ""
}
```

#### Errors

- Return an HTTP status code **≥ 400** (e.g. `400`, `500`) and optionally a JSON or text body.
- The eval app will surface something like: `Evren API error: <status> <statusText> — <body>`.

---

## Summary checklist for implementers

1. Expose **`POST /evren`** (or mount it so the full URL is `<base>/evren`).
2. Accept JSON body with at least **`input_message`**; optionally **`img_url`** and **`context`** (object).
3. Return **200** with JSON body containing:
   - **`evren_response`** (string): Evren’s reply.
   - **`detected_flags`** (string): Flags detected for this turn (e.g. comma-separated or empty string).
4. Use **JSON** for request and response and `Content-Type: application/json` where applicable.

Once this is implemented, the Maibel evaluation app can use your Evren service by setting the “Evren API URL” to your base URL (e.g. `http://localhost:8000` or `https://your-evren-service.com`).
