/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // pdfjs-dist (via pdf-parse) breaks when bundled by webpack — load the
    // parsing packages from node_modules at runtime instead.
    serverComponentsExternalPackages: ['pdf-parse', 'pdfjs-dist', 'mammoth'],
  },
};

module.exports = nextConfig;
