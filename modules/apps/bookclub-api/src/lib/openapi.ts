// Served as static assets (see app.ts's /openapi.yaml and /docs
// routes) -- kept as a TS string export rather than a separate
// .yaml/.html file so it compiles into dist/ automatically with
// everything else (tsc doesn't copy non-TS assets on its own).
// Mirrors post-api's own openapi.ts/docs pattern (Swagger UI from a
// CDN, pointed at this spec) -- see that file for the reasoning.
//
// The realtime room protocol (WebSocket messages: page:set,
// draw:stroke, text:add/move/resize/remove, chat:send, cursor:move,
// and their broadcasts) has no HTTP shape to describe here -- it's
// documented in ws/roomHub.ts and app.ts's own inline comments next
// to each message handler instead.

export const openApiYaml = `openapi: 3.0.3
info:
  title: bookclub-api
  description: >
    Backend for the Clube do Livro (Book Club) real-time reading
    rooms. Owns PDF document metadata and its own MinIO-backed file
    storage; room and chat message state live in domain-api/
    domain-worker's Room/Message aggregates (see /rooms below), same
    CQRS pipeline post-api uses -- writes return 202 Accepted, not an
    immediate 200/201/204. The live room experience itself (page
    turns, drawing, cursors, chat) is a WebSocket protocol at
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
      summary: List reading rooms
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
        Create a room: uploads a PDF (stored in MinIO) and asks
        domain-worker to create the room aggregate (async — returns
        202, not the created row)
      security:
        - bearerAuth: []
      requestBody:
        required: true
        content:
          multipart/form-data:
            schema:
              type: object
              required: [title, pdf]
              properties:
                title:
                  type: string
                  maxLength: 200
                pdf:
                  type: string
                  format: binary
                  description: Must be a real PDF (checked by magic number, not just Content-Type), 25MB max.
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
      summary: Get a single room
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
        End the room (host only) — the book is finished, not paused;
        this is the only way a room stops existing (async — returns
        202)
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
  /rooms/{id}/pdf:
    parameters:
      - name: id
        in: path
        required: true
        schema:
          type: string
          format: uuid
    get:
      summary: Stream the room's PDF bytes (proxied from MinIO, session-gated)
      security:
        - bearerAuth: []
      responses:
        "200":
          description: OK
          content:
            application/pdf:
              schema:
                type: string
                format: binary
        "401":
          $ref: "#/components/responses/Unauthorized"
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
        documentId:
          type: string
          format: uuid
        currentPage:
          type: integer
        status:
          type: string
          enum: [open]
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
      description: Authenticated, but not the room's host
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
    <title>bookclub-api docs</title>
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
