import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Al cambiar entre vistas, volver a una vista visitada hace menos de
    // 30 s reutiliza lo que el navegador ya tiene, sin otro viaje al
    // servidor. Por defecto las vistas dinámicas no se guardan (0 s).
    // Los datos se actualizan al guardar/publicar (revalidatePath) y al
    // pasar los 30 s.
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
  },
};

export default nextConfig;
