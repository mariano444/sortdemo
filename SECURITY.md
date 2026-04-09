## Seguridad del frontend

El codigo que llega al navegador siempre puede ser inspeccionado o copiado.
No existe una proteccion total desde HTML, CSS o JS del lado cliente.

Medidas reales aplicadas en este proyecto:

- `index.html` ahora carga `index.css` e `index.js` por separado para mejorar mantenimiento y despliegue.
- Se agrego una politica CSP basica para limitar origenes de scripts, estilos, imagenes y conexiones.
- La logica sensible debe vivir en Supabase, RPC y Edge Functions, no en el navegador.

Medidas recomendadas a futuro:

- Mover cualquier validacion critica de negocio al backend.
- Guardar secretos solo en variables seguras del servidor o Supabase Vault.
- Activar RLS estricta en todas las tablas que reciban operaciones publicas.
- Versionar y minificar los archivos publicos para despliegue productivo.
- Servir la web detras de headers HTTP de seguridad desde Netlify o tu hosting.
