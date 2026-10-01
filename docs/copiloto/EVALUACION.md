# Resultados de evaluación

Catálogo 2026-09-26.4 · modelo jev-latest (typesafe) · 220 frases · 2026-10-01T11:24:18.488Z

Latencia de la llamada nº 1: mediana 158 ms · p90 213 ms · máxima 20537 ms.

## Por mensaje

| Resultado | Frases |
| --- | --- |
| Correcto | 209 (95 %) |
| Pregunta de más (seguro) | 9 (4 %) |
| Error sin escritura | 2 |
| **Error con borrador equivocado** | **0** |

## Por grupo de frases

| Grupo | Frases | Correcto | Pregunta de más | Error | Error con borrador |
| --- | --- | --- | --- | --- | --- |
| base | 64 | 92 % | 5 | 0 | 0 |
| dato | 12 | 92 % | 0 | 1 | 0 |
| natural | 33 | 88 % | 3 | 1 | 0 |
| jerga | 5 | 100 % | 0 | 0 | 0 |
| erratas | 4 | 100 % | 0 | 0 | 0 |
| excepcion | 8 | 100 % | 0 | 0 | 0 |
| fuera | 8 | 100 % | 0 | 0 | 0 |
| operaciones | 21 | 95 % | 1 | 0 | 0 |
| consumo | 2 | 100 % | 0 | 0 | 0 |
| encargado | 58 | 100 % | 0 | 0 | 0 |
| cajas | 5 | 100 % | 0 | 0 | 0 |

## Por decisión (elección más probable de Jev)

| Decisión | Aciertos | Confianza media si acierta | Confianza media si falla | ECE |
| --- | --- | --- | --- | --- |
| intent | 220/220 (100 %) | 0.97 | - | 0.035 |
| herramienta | 80/80 (100 %) | 0.96 | - | 0.035 |
| tipo_accion | 107/108 (99 %) | 0.96 | 0.58 | 0.036 |
| local | 98/98 (100 %) | 0.97 | - | 0.027 |
| local_destino | 16/16 (100 %) | 1.00 | - | 0.004 |
| producto | 108/108 (100 %) | 0.87 | - | 0.133 |
| periodo | 13/13 (100 %) | 1.00 | - | 0.000 |
| destino | 6/6 (100 %) | 1.00 | - | 0.005 |
| dato | 33/35 (94 %) | 0.95 | 0.47 | 0.038 |
| inyeccion | 220/220 (100 %) | - | - | - |

ECE: diferencia media entre la confianza de Jev y su acierto real (0 = fiel; 0,1 = se desvía 10 puntos).

## Calibración: umbral de «actuar» por decisión y contexto

Recomendado = el umbral más bajo con el que no se habría actuado en ningún error de este conjunto, más 0,05 de margen. «revisar pregunta» = hay errores con confianza muy alta: el umbral no los evita, hay que mejorar la pregunta a Jev.

| Decisión | Contexto | Casos | Errores | Actual | Cobertura actual | Recomendado | Cobertura recomendada |
| --- | --- | --- | --- | --- | --- | --- | --- |
| intent | lectura (intent_lectura) | 104 | 0 | 0.60 | 98 % | 0.50 | 98 % |
| intent | escritura (intent_accion) | 116 | 0 | 0.75 | 98 % | 0.50 | 99 % |
| herramienta | lectura (herramienta) | 80 | 0 | 0.65 | 100 % | 0.50 | 100 % |
| tipo_accion | escritura (tipo_accion) | 108 | 1 | 0.85 | 87 % | 0.65 | 97 % |
| local | lectura (local_consulta) | 32 | 0 | 0.65 | 100 % | 0.50 | 100 % |
| local | escritura (local_borrador) | 66 | 0 | 0.85 | 91 % | 0.50 | 100 % |
| local_destino | escritura (local_borrador) | 16 | 0 | 0.85 | 100 % | 0.50 | 100 % |
| producto | lectura (producto_consulta) | 40 | 0 | 0.65 | 88 % | 0.50 | 95 % |
| producto | escritura (producto_borrador) | 68 | 0 | 0.85 | 78 % | 0.50 | 93 % |
| destino | lectura (destino) | 6 | 0 | 0.80 | 100 % | 0.50 | 100 % |
| dato | lectura (dato) | 35 | 2 | 0.60 | 91 % | 0.55 | 91 % |

## Fiabilidad por tramo de confianza (todas las decisiones)

| Confianza | Casos | Acierto real | Confianza media |
| --- | --- | --- | --- |
| 0.00–0.50 | 13 | 85 % | 0.38 |
| 0.50–0.70 | 15 | 93 % | 0.59 |
| 0.70–0.85 | 42 | 100 % | 0.78 |
| 0.85–0.95 | 82 | 100 % | 0.90 |
| 0.95–1.00 | 532 | 100 % | 0.99 |

## Detalle de lo que no fue «correcto»

| Frase | Grupo | Resultado | Plan | Detalle |
| --- | --- | --- | --- | --- |
| han llegado 3 cajas de coca a 13,50 € en Parador | base | pregunta | clarify | pregunta por tipo_accion |
| recibido el pedido de Distribuciones Canarias en Parador: 2 cajas de barceló | base | pregunta | clarify | pregunta por tipo_accion |
| entran 4 sacos de limones en el Vivero | base | pregunta | clarify | pregunta por tipo_accion |
| prepara el pedido de la semana para Parador | base | pregunta | clarify | pregunta por tipo_accion |
| haz el pedido del finde para el Vivero | base | pregunta | clarify | pregunta por tipo_accion |
| ¿cuánta pasta tenemos metida en ron? | dato | error | consultar | dato=cantidad |
| tenemos limones? | natural | error | consultar | dato=general |
| acaban de traer 2 cajas de brugal al parador | natural | pregunta | clarify | pregunta por tipo_accion |
| nos han entregado 5 packs de agua en pickels | natural | pregunta | clarify | pregunta por tipo_accion |
| prepárame el pedido para la oliva | natural | pregunta | clarify | pregunta por tipo_accion |
| manda el pedido de Bebidas del Sur | operaciones | pregunta | clarify | pregunta por tipo_accion |

Coste Jev de esta evaluación: 220 llamadas, 633466 tokens de entrada, ~0.026606 $.
