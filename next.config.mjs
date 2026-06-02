/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      // Serve the existing static front end (public/index.html) at the root.
      // /admin, /api/*, and /cms-data.json are handled by the app router and are unaffected.
      { source: "/", destination: "/index.html" },
    ];
  },
};
export default nextConfig;
