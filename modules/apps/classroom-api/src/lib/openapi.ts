// Served as static assets (see app.ts's /openapi.yaml and /docs
// routes) -- kept as a TS string export rather than a separate
// .yaml/.html file so it compiles into dist/ automatically with
// everything else (tsc doesn't copy non-TS assets on its own).
// Mirrors bookclub-api/post-api's own openapi.ts/docs pattern (Swagger
// UI from a CDN, pointed at this spec).
//
// The realtime class protocol (WebSocket messages: chat:send,
// notepad:update, webrtc:signal, and their broadcasts) has no HTTP
// shape to describe here -- it's documented in ws/roomHub.ts and
// app.ts's own inline comments next to each message handler instead.

export const openApiYaml = `openapi: 3.0.3
info:
  title: classroom-api
  description: >
    Backend for "Aulas" (Classes): a host shares their screen or
    camera live (peer-to-peer WebRTC, this service only relays
    signaling) alongside a shared notepad and chat. Room and chat
    message state live in domain-api/domain-worker's Room/Message
    aggregates (the same generic aggregates bookclub-api uses, with
    documentId always empty here -- a class has no document), same
    CQRS pipeline post-api uses -- writes return 202 Accepted, not an
    immediate 200/201/204. The live class experience itself (video
    signaling, the notepad, chat) is a WebSocket protocol at
    /rooms/{id}/ws, not described in this HTTP-only spec -- see
    src/ws/roomHub.ts and src/app.ts for that.
    Auth is Better Auth (email+password, bearer token or session
    cookie) -- see https://www.better-auth.com/docs, not repeated
    here. Sessions are validated against the SAME database/secret
    post-api's /api/auth/* issues them from; sign-up/sign-in only
    ever happens through post-api.
  version: "1.0.0"
servers:
  - url: /
paths:
  /health:
    get:
      summary: Liveness check
      responses:
        "200":
          description: OK
          content:
            application/json:
              schema:
                type: object
                properties:
                  status:
                    type: string
                    example: ok
  /rooms:
    get:
      summary: List classes
      responses:
        "200":
          description: OK
          content:
            application/json:
              schema:
                type: object
                properties:
                  rooms:
                    type: array
                    items:
                      $ref: "#/components/schemas/Room"
    post:
      summary: >
        Open a class: asks domain-worker to create the room aggregate
        (async — returns 202, not the created row)
      security:
        - bearerAuth: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [title]
              properties:
                title:
                  type: string
                  maxLength: 200
      responses:
        "202":
          $ref: "#/components/responses/Accepted"
        "400":
          $ref: "#/components/responses/BadRequest"
        "401":
          $ref: "#/components/responses/Unauthorized"
  /rooms/{id}:
    parameters:
      - name: id
        in: path
        required: true
        schema:
          type: string
          format: uuid
    get:
      summary: Get a single class
      responses:
        "200":
          description: OK
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Room"
        "404":
          $ref: "#/components/responses/NotFound"
    delete:
      summary: >
        End the class (host only) — a soft close, not a deletion: sets
        status to "closed" and keeps the room and its chat history
        exactly as they were. A closed class stays listed and its chat
        stays readable, it just stops accepting new chat, notepad
        edits, or WebRTC signaling (async — returns 202)
      security:
        - bearerAuth: []
      responses:
        "202":
          $ref: "#/components/responses/Accepted"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "403":
          $ref: "#/components/responses/Forbidden"
        "404":
          $ref: "#/components/responses/NotFound"
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      description: >
        Better Auth session token — obtained from post-api's
        /api/auth/sign-in/email (this service never issues its own).
  schemas:
    Room:
      type: object
      properties:
        id:
          type: string
          format: uuid
        title:
          type: string
        hostId:
          type: string
        status:
          type: string
          enum: [open, paused, closed]
        createdAt:
          type: string
          format: date-time
    Error:
      type: object
      properties:
        error:
          type: string
  responses:
    Accepted:
      description: Command accepted — applied asynchronously by domain-worker
      content:
        application/json:
          schema:
            type: object
            properties:
              command_id:
                type: string
                format: uuid
              status:
                type: string
                example: accepted
    BadRequest:
      description: Invalid request body
      content:
        application/json:
          schema:
            $ref: "#/components/schemas/Error"
    Unauthorized:
      description: Missing or invalid session
      content:
        application/json:
          schema:
            $ref: "#/components/schemas/Error"
    Forbidden:
      description: Authenticated, but not the class's host
      content:
        application/json:
          schema:
            $ref: "#/components/schemas/Error"
    NotFound:
      description: Room not found
      content:
        application/json:
          schema:
            $ref: "#/components/schemas/Error"
`;

export const docsHtml = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>classroom-api docs</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script>
      window.onload = () => {
        window.ui = SwaggerUIBundle({
          url: "/openapi.yaml",
          dom_id: "#swagger-ui",
        });
      };
    </script>
  </body>
</html>
`;
