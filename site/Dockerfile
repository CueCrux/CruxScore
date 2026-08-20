# Static preview image for scorecrux.com.
#
# Chainguard nginx (rebuilt daily, zero known CVEs) per CLAUDE.md container policy.
# Free-tier Chainguard is :latest-only, so this base cannot carry a digest pin.
#
# Two behavioural differences vs the previous nginx:alpine base:
#   * it runs as non-root (uid 65532), so it cannot bind a privileged port;
#   * its bundled conf.d/nginx.default.conf therefore listens on 8080, not 80.
# The document root is unchanged (/usr/share/nginx/html), so the COPY below is
# the same as before and no custom nginx config is needed.
#
# The base sets ENTRYPOINT ["/usr/sbin/nginx"] plus a CMD carrying the config
# flags; both are deliberately left alone. The runtime has no shell, so anything
# added here must be exec form.
#
#   docker build -t scorecrux-site site/
#   docker run --rm -p 8888:8080 scorecrux-site   # was -p 8888:80
FROM cgr.dev/chainguard/nginx:latest
COPY index.html /usr/share/nginx/html/index.html
EXPOSE 8080
