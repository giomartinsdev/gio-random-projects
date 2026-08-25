// Served as static assets (see app.ts's /openapi.yaml and /docs
// routes) -- kept as TS string exports rather than separate .yaml/.html
// files so they compile into dist/ automatically with everything else
// (tsc doesn't copy non-TS assets on its own). Mirrors domain-api's
// own openapi.yaml/docs.html pattern (Swagger UI from a CDN, pointed
// at this spec).

export const openApiYaml = `openapi: 3.0.3
info:
  title: post-api
  description: >
    Headless content API for Buteco dos Devs. Owns no post storage of
    its own -- every /posts write is forwarded to domain-api, which
    publishes a command applied asynchronously by domain-worker.
    POST/PATCH/DELETE return 202 Accepted, not an immediate
    200/201/204; a GET right after a write may not reflect it yet.
    Auth is Better Auth (email+password, bearer token) under
    /api/auth/* -- see https://www.better-auth.com/docs for that
    surface's own shape, not repeated here.
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
  /feed.xml:
    get:
      summary: RSS 2.0 feed of the most recent published posts (last 50)
      responses:
        "200":
          description: OK
          content:
            application/rss+xml:
              schema:
                type: string
  /discord/token:
    post:
      summary: >
        Discord Activity OAuth handshake: exchanges a one-time
        authorization code (from the embedded app's
        discordSdk.commands.authorize()) for an access token, using
        this server's DISCORD_CLIENT_SECRET. Only present at all when
        DISCORD_CLIENT_ID/DISCORD_CLIENT_SECRET are configured -- a
        404 here means the Discord Activity isn't set up yet, not a
        broken deploy.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [code]
              properties:
                code:
                  type: string
      responses:
        "200":
          description: OK
          content:
            application/json:
              schema:
                type: object
                properties:
                  access_token:
                    type: string
        "400":
          $ref: "#/components/responses/BadRequest"
        "502":
          description: Discord's own token endpoint rejected the exchange
  /image-proxy:
    get:
      summary: >
        Re-fetches an arbitrary image URL and streams it back. Exists
        for the Discord Activity: a post's coverImageUrl/inline images
        are whatever external host the author pasted, unreachable from
        inside Discord's iframe sandbox without going through a
        mapped domain first. Rejects loopback/private/link-local
        hostnames and non-image responses.
      parameters:
        - name: url
          in: query
          required: true
          schema:
            type: string
      responses:
        "200":
          description: OK
          content:
            image/*:
              schema:
                type: string
                format: binary
        "400":
          $ref: "#/components/responses/BadRequest"
        "502":
          description: Upstream fetch failed, redirected, returned non-2xx, wasn't an image, or exceeded the size limit
  /posts:
    get:
      summary: List published posts
      responses:
        "200":
          description: OK
          content:
            application/json:
              schema:
                type: object
                properties:
                  posts:
                    type: array
                    items:
                      $ref: "#/components/schemas/Post"
    post:
      summary: Create a post (async — returns 202, not the created row)
      security:
        - bearerAuth: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/PostInput"
      responses:
        "202":
          $ref: "#/components/responses/Accepted"
        "400":
          $ref: "#/components/responses/BadRequest"
        "401":
          $ref: "#/components/responses/Unauthorized"
  /posts/{slug}:
    parameters:
      - name: slug
        in: path
        required: true
        schema:
          type: string
    get:
      summary: Get a single published post by slug
      responses:
        "200":
          description: OK
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Post"
        "404":
          $ref: "#/components/responses/NotFound"
  /posts/{id}:
    parameters:
      - name: id
        in: path
        required: true
        schema:
          type: string
          format: uuid
    patch:
      summary: Edit a post (owner only, async — returns 202)
      security:
        - bearerAuth: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/PostEditInput"
      responses:
        "202":
          $ref: "#/components/responses/Accepted"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "403":
          $ref: "#/components/responses/Forbidden"
        "404":
          $ref: "#/components/responses/NotFound"
    delete:
      summary: Delete a post (owner only, async — returns 202)
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
        Better Auth session token — obtained from the "set-auth-token"
        response header (or the "token" field in the JSON body) of
        /api/auth/sign-in/email or /api/auth/sign-up/email.
  schemas:
    Post:
      type: object
      properties:
        id:
          type: string
          format: uuid
        authorId:
          type: string
        title:
          type: string
        slug:
          type: string
        bodyMarkdown:
          type: string
        excerpt:
          type: string
        coverImageUrl:
          type: string
        type:
          type: string
          enum: [article, course]
        status:
          type: string
          enum: [draft, published]
        source:
          type: string
          enum: [native, imported]
        sourceUrl:
          type: string
        createdAt:
          type: string
          format: date-time
        updatedAt:
          type: string
          format: date-time
        publishedAt:
          type: string
          format: date-time
          nullable: true
    PostInput:
      type: object
      required: [title, bodyMarkdown]
      properties:
        title:
          type: string
          maxLength: 300
        bodyMarkdown:
          type: string
          maxLength: 500000
        excerpt:
          type: string
          maxLength: 1000
        coverImageUrl:
          type: string
          maxLength: 2048
        type:
          type: string
          enum: [article, course]
        status:
          type: string
          enum: [draft, published]
    PostEditInput:
      type: object
      properties:
        title:
          type: string
          maxLength: 300
        bodyMarkdown:
          type: string
          maxLength: 500000
        excerpt:
          type: string
          maxLength: 1000
        coverImageUrl:
          type: string
          maxLength: 2048
        status:
          type: string
          enum: [draft, published]
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
      description: Missing or invalid bearer token
      content:
        application/json:
          schema:
            $ref: "#/components/schemas/Error"
    Forbidden:
      description: Authenticated, but not the post's author
      content:
        application/json:
          schema:
            $ref: "#/components/schemas/Error"
    NotFound:
      description: Post not found
      content:
        application/json:
          schema:
            $ref: "#/components/schemas/Error"
`;

export const docsHtml = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>post-api docs</title>
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
