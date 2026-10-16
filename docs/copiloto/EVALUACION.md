# Resultados de evaluación

Repetición sin Jev de la evaluación del 2026-10-16T15:06:07.701Z (catálogo 2026-10-16.1, modelo jev-latest) · 220 frases

Latencia de la llamada nº 1: mediana 118 ms · p90 161 ms · máxima 449 ms.

## Por mensaje

| Resultado | Frases |
| --- | --- |
| Correcto | 218 (99 %) |
| Pregunta de más (seguro) | 1 (0 %) |
| Error sin escritura | 1 |
| **Error con borrador equivocado** | **0** |

## Por grupo de frases

| Grupo | Frases | Correcto | Pregunta de más | Error | Error con borrador |
| --- | --- | --- | --- | --- | --- |
| base | 64 | 98 % | 1 | 0 | 0 |
| dato | 12 | 100 % | 0 | 0 | 0 |
| natural | 33 | 97 % | 0 | 1 | 0 |
| jerga | 5 | 100 % | 0 | 0 | 0 |
| erratas | 4 | 100 % | 0 | 0 | 0 |
| excepcion | 8 | 100 % | 0 | 0 | 0 |
| fuera | 8 | 100 % | 0 | 0 | 0 |
| operaciones | 21 | 100 % | 0 | 0 | 0 |
| consumo | 2 | 100 % | 0 | 0 | 0 |
| encargado | 58 | 100 % | 0 | 0 | 0 |
| cajas | 5 | 100 % | 0 | 0 | 0 |

## Por decisión (elección más probable de Jev)

| Decisión | Aciertos | Confianza media si acierta | Confianza media si falla | ECE |
| --- | --- | --- | --- | --- |
| intent | 220/220 (100 %) | 0.97 | - | 0.033 |
| herramienta | 80/80 (100 %) | 0.97 | - | 0.031 |
| tipo_accion | 107/108 (99 %) | 0.96 | 0.60 | 0.033 |
| local | 98/98 (100 %) | 0.98 | - | 0.024 |
| local_destino | 16/16 (100 %) | 1.00 | - | 0.002 |
| producto | 108/108 (100 %) | 0.86 | - | 0.137 |
| periodo | 13/13 (100 %) | 1.00 | - | 0.000 |
| destino | 6/6 (100 %) | 1.00 | - | 0.002 |
| dato | 34/35 (97 %) | 0.95 | 0.49 | 0.039 |
| inyeccion | 220/220 (100 %) | - | - | - |

ECE: diferencia media entre la confianza de Jev y su acierto real (0 = fiel; 0,1 = se desvía 10 puntos).

## Calibración: umbral de «actuar» por decisión y contexto

Recomendado = el umbral más bajo con el que no se habría actuado en ningún error de este conjunto, más 0,05 de margen. «revisar pregunta» = hay errores con confianza muy alta: el umbral no los evita, hay que mejorar la pregunta a Jev.

| Decisión | Contexto | Casos | Errores | Actual | Cobertura actual | Recomendado | Cobertura recomendada |
| --- | --- | --- | --- | --- | --- | --- | --- |
| intent | lectura (intent_lectura) | 104 | 0 | 0.60 | 97 % | 0.50 | 98 % |
| intent | escritura (intent_accion) | 116 | 0 | 0.75 | 99 % | 0.50 | 99 % |
| herramienta | lectura (herramienta) | 80 | 0 | 0.65 | 100 % | 0.50 | 100 % |
| tipo_accion | escritura (tipo_accion) | 108 | 1 | 0.70 | 98 % | 0.70 | 98 % |
| local | lectura (local_consulta) | 32 | 0 | 0.65 | 100 % | 0.50 | 100 % |
| local | escritura (local_borrador) | 66 | 0 | 0.85 | 91 % | 0.50 | 100 % |
| local_destino | escritura (local_borrador) | 16 | 0 | 0.85 | 100 % | 0.50 | 100 % |
| producto | lectura (producto_consulta) | 40 | 0 | 0.65 | 88 % | 0.50 | 95 % |
| producto | escritura (producto_borrador) | 68 | 0 | 0.85 | 72 % | 0.50 | 94 % |
| destino | lectura (destino) | 6 | 0 | 0.80 | 100 % | 0.50 | 100 % |
| dato | lectura (dato) | 35 | 1 | 0.60 | 91 % | 0.55 | 91 % |

## Fiabilidad por tramo de confianza (todas las decisiones)

| Confianza | Casos | Acierto real | Confianza media |
| --- | --- | --- | --- |
| 0.00–0.50 | 11 | 91 % | 0.35 |
| 0.50–0.70 | 15 | 93 % | 0.56 |
| 0.70–0.85 | 45 | 100 % | 0.79 |
| 0.85–0.95 | 73 | 100 % | 0.90 |
| 0.95–1.00 | 540 | 100 % | 0.99 |

## Detalle de lo que no fue «correcto»

| Frase | Grupo | Resultado | Plan | Detalle |
| --- | --- | --- | --- | --- |
| invitación: 2 tónicas en Pickels | base | pregunta | clarify | pregunta por producto |
| tenemos limones? | natural | error | consultar | dato=general |

