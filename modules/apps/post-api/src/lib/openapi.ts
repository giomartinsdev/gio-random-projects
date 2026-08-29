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
  /images/upload:
    post:
      summary: Upload an image to public object storage
      description: >
        Multipart upload for the editor's cover and inline-image
        buttons. Stores the bytes in MinIO (bucket is public-read) and
        returns the public URL the client pastes into coverImageUrl or
        into the markdown body as an image reference -- nothing is
        persisted post-side. jpeg/png/webp/gif only, 8 MB max.
      security:
        - bearerAuth: []
      requestBody:
        required: true
        content:
          multipart/form-data:
            schema:
              type: object
              required: [file]
              properties:
                file:
                  type: string
                  format: binary
                  description: Image bytes; jpeg, png, webp or gif, up to 8 MB
      responses:
        "200":
          description: Stored; url is the public URL to reference
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/UploadedImage"
        "400":
          $ref: "#/components/responses/BadRequest"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "502":
          description: Object storage rejected the upload -- try again
  /posts:
    get:
      summary: List published posts
      description: >
        Optional ?q= narrows to published posts whose title, excerpt or
        body contain the query (case-insensitive substring, wildcards
        escaped server-side); shape is the same with or without it.
      parameters:
        - name: q
          in: query
          required: false
          schema:
            type: string
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
  /posts/import:
    post:
      summary: >
        Fetch a public dev.to / TabNews / Medium article and normalize
        it to a markdown draft. Only supports those three hosts
        (per-provider API or scrape); the response is NOT a created
        post -- it pre-fills an editor that the author reviews and
        publishes through the normal POST /posts. The attribution
        footer ("Retirado daqui do ...") is already appended to
        bodyMarkdown.
      security:
        - bearerAuth: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [url]
              properties:
                url:
                  type: string
                  description: A public link on dev.to, tabnews.com.br or medium.com
      responses:
        "200":
          description: OK
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ImportedPost"
        "400":
          $ref: "#/components/responses/BadRequest"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "502":
          description: The source page could not be fetched or parsed
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
      summary: >
        Edit a post (owner only, async — returns 202). Never
        overwrites content without a trace: domain-worker archives the
        pre-edit row into post_revisions before applying the update,
        in the same transaction.
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
      summary: >
        Delete a post (owner only, async — returns 202). Soft delete
        only: domain-worker sets deleted_at instead of removing the
        row, so the post disappears from every read (list, by slug,
        by id) without ever being physically destroyed.
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
  /posts/by-author/{id}:
    parameters:
      - name: id
        in: path
        required: true
        schema:
          type: string
    get:
      summary: >
        One author's posts for the profile pages — published only for
        everyone except a session identifying as that author, who gets
        their drafts too (status picks them out).
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
  /posts/liked/by-me:
    get:
      summary: Posts the current user liked, newest like first
      description: >
        Crosses the user's like history against the published list.
        Likes on drafts/deleted posts silently drop out of the result.
      security:
        - bearerAuth: []
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
        "401":
          $ref: "#/components/responses/Unauthorized"
  /posts/{id}/like:
    parameters:
      - name: id
        in: path
        required: true
        schema:
          type: string
          format: uuid
    post:
      summary: Like a post (idempotent — re-liking returns the same state)
      security:
        - bearerAuth: []
      responses:
        "200":
          description: OK
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/LikeState"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "404":
          $ref: "#/components/responses/NotFound"
    delete:
      summary: Unlike a post (200 even if it was not liked)
      security:
        - bearerAuth: []
      responses:
        "200":
          description: OK
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/LikeState"
        "401":
          $ref: "#/components/responses/Unauthorized"
  /users/{id}:
    parameters:
      - name: id
        in: path
        required: true
        schema:
          type: string
    get:
      summary: Public profile identity + distinct-visitor view count
      description: >
        Never returns email. viewCount only counts logged-in visitors;
        anonymous visits are not tracked.
      responses:
        "200":
          description: OK
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ProfileResponse"
        "404":
          $ref: "#/components/responses/NotFound"
  /users/{id}/view:
    parameters:
      - name: id
        in: path
        required: true
        schema:
          type: string
    post:
      summary: Record a profile visit by the authenticated viewer
      description: >
        One row per (profile, viewer) pair — repeat visits only bump
        last_viewed_at. Viewing your own profile is never counted.
      security:
        - bearerAuth: []
      responses:
        "200":
          description: OK
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ViewAck"
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
        likeCount:
          type: integer
          description: Number of distinct users who liked the post
        likedByMe:
          type: boolean
          description: Whether the calling session's user liked it (false when anonymous)
    LikeState:
      type: object
      properties:
        likeCount:
          type: integer
        likedByMe:
          type: boolean
    PublicUser:
      type: object
      description: Profile identity -- never returns email
      properties:
        id:
          type: string
        name:
          type: string
        image:
          type: string
          nullable: true
        createdAt:
          type: string
          format: date-time
    ProfileResponse:
      type: object
      properties:
        user:
          $ref: "#/components/schemas/PublicUser"
        viewCount:
          type: integer
          description: Distinct logged-in visitors who have seen this profile
    ViewAck:
      type: object
      properties:
        viewCount:
          type: integer
        counted:
          type: boolean
          description: false when the viewer visited their own profile
    ImportedPost:
      type: object
      description: >
        Normalized draft from /posts/import -- not a persisted post.
        bodyMarkdown already carries the attribution footer.
      properties:
        provider:
          type: string
          enum: [dev.to, tabnews, medium]
        title:
          type: string
        bodyMarkdown:
          type: string
        excerpt:
          type: string
          nullable: true
        coverImageUrl:
          type: string
          nullable: true
        originalUrl:
          type: string
    UploadedImage:
      type: object
      description: Public URL of a stored image -- reference it directly, nothing else tracks it.
      properties:
        url:
          type: string
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
