# Oli v0.2

Mascota Canvas 2D de partículas con wrapper React. No cambia el frontend existente ni el motor de decisiones.

```tsx
import { Oli } from '../../../packages/oli/src/Oli';

<Oli state="listening" size={240} />
```

Importar la ruta según la ubicación del consumidor, o instalar este paquete local como `@oli/mascot`. El consumidor debe compilar TSX.

Estados: `idle`, `listening`, `thinking`, `focused`, `understanding`, `happy`, `celebrating`.

Props: `state`, `size` (px, 240 por defecto), `speed` (1), `dark` (true), `paused` (false), `particles` (1600), `className`, `label` (texto accesible).

`particles` cuenta los puntos del cuerpo; se añade un 24% para ojos y boca. La cara nunca usa ni atenúa partículas de la esfera, evitando huecos.

`idle` no tiene rostro. Los ojos abiertos son óvalos de partículas sin pupilas. Todas las fases activas parpadean; cada una tiene gestos propios (asentir, mirar al pensar, concentrarse, descubrir, sonreír, rebotar y reír). Las expresiones y proporciones se interpolan al interrumpir una fase. El renderer respeta `prefers-reduced-motion`, pausa al salir de pantalla y limpia observadores y RAF al desmontar, incluido React Strict Mode. `paused` y `speed={0}` muestran estáticamente el estado elegido. No identifica ni decide estados financieros: el consumidor pasa un estado visual a partir del estado real de su aplicación.

El tamaño del canvas incluye aire alrededor de la esfera. Para avatares pequeños conviene probar `particles={500}`; todavía no se promete fidelidad del rostro a 20 px ni rendimiento de hardware móvil.

## Demo

Desde la raíz:

```sh
node examples/oli/build.mjs
python3 -m http.server 4174 --directory examples/oli/dist
node --test packages/oli/test/*.test.js
```

Abrir http://localhost:4174. La demo permite elegir expresiones, ver su secuencia, tocar para saludar, pausar, cambiar fondo y descargar un retrato PNG. No usa micrófono, backend ni datos de facturas.

El núcleo también se puede importar sin React desde `@oli/mascot/canvas`: `new OliCanvas(canvas, options)`, `setState`, `setOptions`, `lookAt`, `ripple`, `destroy`.

## Publicación en el dominio

Demo pública: https://oli30x.ultramare.dev/oli/.

```sh
node examples/oli/build.mjs --domain
apps/api/node_modules/.bin/wrangler deploy --config examples/oli/wrangler.jsonc
```

Worker estático `oli-mascot-demo`, cuenta Tiamat, limitado a `/oli` y `/oli/*`. Los archivos se empaquetan dentro de `oli/` para conservar sus rutas relativas. Publicar esta demo no requiere desplegar `oli-api` ni acceder a D1/R2.
