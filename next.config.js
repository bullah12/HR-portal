/** @type {import('next').NextConfig} */
const nextConfig = {
  // Self-contained server bundle for the Docker image (Phase 5).
  output: 'standalone',
  experimental: {
    // pdfjs-dist (via pdf-parse) breaks when bundled by webpack — load the
    // parsing packages from node_modules at runtime instead.
    serverComponentsExternalPackages: ['pdf-parse', 'pdfjs-dist', 'mammoth', 'pdfkit'],
  },
};

module.exports = nextConfig;
