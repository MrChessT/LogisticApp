# Conversaciones de prueba

Catálogo real de Vivero 55 · Jev REAL · catálogo Jev 2026-10-16.1 · 2026-10-16T10:34:32.470Z

## Traspaso sin cantidad ni unidad

**Usuario:** pasa larios del Parador al Vivero  
&nbsp;&nbsp;*Entendido: Traspaso entre locales · Parador · Vivero · Larios 12*  
**Asistente:** ¿Qué cantidad de Larios 12?  
✅

**Usuario:** 3  
&nbsp;&nbsp;*Entendido: Traspaso entre locales · Parador · Vivero · Larios 12 · 3*  
**Asistente:** ¿En qué formato son las 3 de Larios 12?  
&nbsp;&nbsp;Opciones: [Botella 70 cl] [Caja 6]  
✅

**Usuario:** cajas  
&nbsp;&nbsp;*Entendido: Traspaso entre locales · Parador · Vivero · Larios 12 · 3*  
**Asistente:** Revísalo y confírmalo si está bien.  
&nbsp;&nbsp;Borrador: *Traspaso Parador → Vivero: 3 × Caja 6 de Larios 12* — avisos: Solo constan 10 botellas de Larios 12 en stock.  
✅

## Traspaso claro con «ambigüedad» y sin espacio (caso real)

**Usuario:** haz un traspaso de vivero a pickels de 100 heineken tercio  
&nbsp;&nbsp;*Entendido: Traspaso entre locales · Vivero · Pickels · Heineken tercio 33 cl · 100*  
**Asistente:** ¿En qué formato son las 100 de Heineken tercio 33 cl?  
&nbsp;&nbsp;Opciones: [Unidades sueltas] [Caja 24]  
✅

**Usuario:** [botón] Unidades sueltas  
&nbsp;&nbsp;*Entendido: Traspaso entre locales · Vivero · Pickels · Heineken tercio 33 cl · 100*  
**Asistente:** Revísalo y confírmalo si está bien.  
&nbsp;&nbsp;Borrador: *Traspaso Vivero → Pickels: 4 cajas + 4 ud de Heineken tercio 33 cl* — avisos: Solo constan 12 ud de Heineken tercio 33 cl en stock.  
✅

## Merma de «ginebra»: hay que decir cuál

**Usuario:** se han roto 2 botellas de ginebra en el Vivero  
&nbsp;&nbsp;*Entendido: Registrar merma · Vivero · Varios productos*  
**Asistente:** ¿Cuál de estos productos es «2 botellas de ginebra»?  
&nbsp;&nbsp;Opciones: [Beefeater] [Bombay Sapphire] [G'Vine Floraison Magnum] [Gin Mare]  
✅

**Usuario:** larios  
&nbsp;&nbsp;*Entendido: Registrar merma · Vivero · Larios 12 · 2 botellas*  
**Asistente:** Revísalo y confírmalo si está bien.  
&nbsp;&nbsp;Borrador: *Merma: 2 × Botella 70 cl de Larios 12 en Vivero*  
✅

## Sin local: pregunta y se contesta escribiendo

**Usuario:** tira 3 bolsas de hielo picado  
&nbsp;&nbsp;*Entendido: Registrar merma*  
**Asistente:** ¿En qué local?  
&nbsp;&nbsp;Opciones: [La Oliva] [Parador] [Pickels] [Vivero]  
✅

**Usuario:** en el vivero  
&nbsp;&nbsp;*Entendido: Registrar merma · Vivero · Hielo picado 2 kg · 3 bolsas*  
**Asistente:** Revísalo y confírmalo si está bien.  
&nbsp;&nbsp;Borrador: *Merma: 3 × Bolsa de Hielo picado 2 kg en Vivero*  
✅

## Una orden nueva en mitad de una pregunta

**Usuario:** quita unas cocas  
&nbsp;&nbsp;*Entendido: Registrar merma*  
**Asistente:** ¿En qué local?  
&nbsp;&nbsp;Opciones: [Pickels] [La Oliva] [Parador] [Vivero]  
❌ esperaba una pregunta de «tipo_accion» y preguntó por «local»

**Usuario:** ¿cuánto ron queda en Parador?  
&nbsp;&nbsp;*Entendido: Consultar stock · Parador · Varios productos · Cantidad*  
**Asistente:** Stock de 8 productos en Parador. 1 bajo mínimo.  

| Producto | Cantidad |
| --- | --- |
| Cacique 500 | 3 botellas |
| Ron Zacapa 23 | 11 botellas |
| Diplomático Reserva Exclusiva | 4 botellas |
| Havana Club 7 Años | 7 botellas |
| … 1 filas más |

✅

## Cantidad sin unidad en un refresco

**Usuario:** pasa 6 cocas de Parador a Pickels  
&nbsp;&nbsp;*Entendido: Traspaso entre locales · Parador · Pickels · Coca-Cola · 6*  
**Asistente:** ¿En qué formato son las 6 de Coca-Cola?  
&nbsp;&nbsp;Opciones: [Unidades sueltas] [Caja 24]  
✅

**Usuario:** [botón] Unidades sueltas  
&nbsp;&nbsp;*Entendido: Traspaso entre locales · Parador · Pickels · Coca-Cola · 6*  
**Asistente:** Revísalo y confírmalo si está bien.  
&nbsp;&nbsp;Borrador: *Traspaso Parador → Pickels: 6 ud de Coca-Cola* — avisos: Solo constan 0 ud de Coca-Cola en stock.  
✅

## Consulta y continuación («¿y en Parador?»)

**Usuario:** ¿cuánto vodka queda en el Vivero?  
**Asistente:** Stock de 7 productos en Vivero. 1 bajo mínimo.  

| Producto | Cantidad |
| --- | --- |
| Absolut Blue | 2 botellas |
| Beluga Noble Magnum | 11 botellas |
| Grey Goose Magnum | 7 botellas |
| Grey Goose Jeroboam | 3 botellas |
| … 3 filas más |

✅

**Usuario:** ¿y en Parador?  
&nbsp;&nbsp;*Entendido: Consultar stock · Parador · Cantidad*  
**Asistente:** Sigo con los mismos productos. Stock de 7 productos en Parador.  

| Producto | Cantidad |
| --- | --- |
| Grey Goose Magnum | 12 botellas |
| Beluga Noble Magnum | 5 botellas |
| Belvedere | 12 botellas |
| Grey Goose | 5 botellas |
| … 1 filas más |

✅

## Confirmar por chat y seguir con otra merma

**Usuario:** baja 2 botellas de beefeater rotas en el Vivero  
&nbsp;&nbsp;*Entendido: Registrar merma · Vivero · Beefeater · 2 botellas*  
**Asistente:** Revísalo y confírmalo si está bien.  
&nbsp;&nbsp;Borrador: *Merma: 2 × Botella 70 cl de Beefeater en Vivero*  
✅

**Usuario:** sí, adelante  
&nbsp;&nbsp;*Entendido: Confirmar*  
**Asistente:** Merma registrada.  
✅

**Usuario:** se ha roto otra de larios en el Vivero  
&nbsp;&nbsp;*Entendido: Registrar merma · Vivero · Larios 12*  
**Asistente:** ¿Qué cantidad de Larios 12?  
✅

**Usuario:** 1 botella  
&nbsp;&nbsp;*Entendido: Registrar merma · Vivero · Larios 12 · 1 botella*  
**Asistente:** Revísalo y confírmalo si está bien.  
&nbsp;&nbsp;Borrador: *Merma: 1 × Botella 70 cl de Larios 12 en Vivero*  
✅

## Recepción con precio

**Usuario:** han llegado 5 cajas de coca zero a 18 € en Parador  
&nbsp;&nbsp;*Entendido: Recepción de mercancía · Parador · Coca-Cola Zero · 5 cajas*  
**Asistente:** Revísalo y confírmalo si está bien.  
&nbsp;&nbsp;Borrador: *Recepción en Parador: 5 × Caja 24 de Coca-Cola Zero*  
✅

## Ir a una pantalla y charlar

**Usuario:** llévame a mermas  
&nbsp;&nbsp;*Entendido: Mermas*  
**Asistente:** Te llevo a Mermas.  
✅

**Usuario:** gracias!  
&nbsp;&nbsp;*Entendido: Conversación*  
**Asistente:** ¡De nada!  
✅

## Consultas sin local: todos los locales, desglosado

**Usuario:** ¿cuánto beefeater hay?  
**Asistente:** Stock de Beefeater: 15 botellas en 2 locales. Pickels 6 botellas · Vivero 9 botellas  
✅

**Usuario:** ¿qué hay en cada sección del Vivero?  
&nbsp;&nbsp;*Entendido: Consultar stock · Vivero · Todo*  
**Asistente:** Stock por secciones en Vivero: 2 secciones con producto.  

| Sección | Producto | Cantidad |
| --- | --- | --- |
| Barra | Patrón El Cielo | 11 botellas |
| Barra | Heineken barril 30 L | 9 barriles |
| Barra | Dom Pérignon Vintage 2012 | 4 botellas |
| Barra | G'Vine Floraison Magnum | 10 botellas |
| … 8 filas más |

✅

## Precio de un producto: solo el precio, no la ficha

**Usuario:** ¿a cuánto compramos el beefeater?  
&nbsp;&nbsp;*Entendido: Ficha de producto · Beefeater · Precio de compra*  
**Asistente:** Beefeater · Caja 6: 69,00 € (Distribuciones Premium Sureste S.L., 03/09/2026) — 11,50 € / Botella 70 cl  
✅

## Traspaso recibido

**Usuario:** ha llegado el traspaso del Parador  
&nbsp;&nbsp;*Entendido: Recibir traspaso · Parador*  
**Asistente:** Revísalo y confírmalo si está bien.  
&nbsp;&nbsp;Borrador: *Recibir traspaso: Parador → Vivero · enviado hace 3 días*  
✅

**Usuario:** sí, adelante  
&nbsp;&nbsp;*Entendido: Confirmar*  
**Asistente:** Traspaso recibido: el stock ya está en el local de destino.  
✅

## Precio y luego cantidad del mismo producto

**Usuario:** oye, ¿a cómo nos sale el larios?  
&nbsp;&nbsp;*Entendido: Ficha de producto · Larios 12 · Precio de compra*  
**Asistente:** Larios 12 · Caja 6: 61,20 € (Distribuciones Premium Sureste S.L., 03/09/2026) — 10,20 € / Botella 70 cl  
✅

**Usuario:** ¿y cuántas botellas quedan?  
&nbsp;&nbsp;*Entendido: Consultar stock · Cantidad*  
**Asistente:** Stock de Larios 12: 25 botellas en 4 locales. La Oliva 8 botellas · Parador 10 botellas · Pickels 2 botellas ⚠ · Vivero 5 botellas ⚠ ⚠ Bajo mínimo en algún local.  
✅

## Valor en euros: solo si se pregunta por dinero

**Usuario:** ¿cuánto dinero tenemos metido en ginebra en el vivero?  
&nbsp;&nbsp;*Entendido: Consultar stock · Vivero · Varios productos · Valor*  
**Asistente:** Stock de 10 productos en Vivero: valor total 2.283,90 €. 2 bajo mínimo.  

| Producto | Cantidad | Valor |
| --- | --- | --- |
| Larios 12 | 5 botellas | 51,00 € |
| Bombay Sapphire | 3 botellas | 49,20 € |
| G'Vine Floraison Magnum | 10 botellas | 710,00 € |
| Nordés Jeroboam | 6 botellas | 648,00 € |
| … 6 filas más |

✅

## Corrige el local escribiendo «no, en el parador»

**Usuario:** se han roto 2 botellas de beefeater  
&nbsp;&nbsp;*Entendido: Registrar merma*  
**Asistente:** ¿En qué local?  
&nbsp;&nbsp;Opciones: [Pickels] [La Oliva] [Parador] [Vivero]  
✅

**Usuario:** no, en el parador  
&nbsp;&nbsp;*Entendido: Registrar merma · Parador · Beefeater · 2 botellas*  
**Asistente:** Revísalo y confírmalo si está bien.  
&nbsp;&nbsp;Borrador: *Merma: 2 × Botella 70 cl de Beefeater en Parador* — avisos: Solo constan 0 botellas de Beefeater en stock.  
✅

## Sin tildes y con jerga

**Usuario:** cuantas cocacolas quedan en el vivero  
**Asistente:** Stock de Coca-Cola, Coca-Cola Zero, Coca-Cola Zero Zero en Vivero. 3 bajo mínimo.  

| Producto | Cantidad |
| --- | --- |
| Coca-Cola Zero Zero | 11 ud |
| Coca-Cola | 8 ud |
| Coca-Cola Zero | 4 ud |

✅

**Usuario:** tírame 2 bolsas de hielo picado del vivero  
&nbsp;&nbsp;*Entendido: Registrar merma · Vivero · Hielo picado 2 kg · 2 bolsas*  
**Asistente:** Revísalo y confírmalo si está bien.  
&nbsp;&nbsp;Borrador: *Merma: 2 × Bolsa de Hielo picado 2 kg en Vivero*  
✅

## Ayuda corta

**Usuario:** ¿qué sabes hacer?  
&nbsp;&nbsp;*Entendido: Conversación*  
**Asistente:** Consulto stock, precios, consumo, lo que más se gasta, pedidos y gasto, y te preparo mermas, traspasos, recepciones, conteos y pedidos para que los confirmes. Prueba: «¿cuánta coca queda en el Vivero?», «pasa 2 cajas y 5 sueltas de tónica del Parador a Pickels» o, en Funciones, «Preparar pedidos» y «Equilibrar locales».  
✅

## Llega el camión con varios productos (varias tónicas: se pregunta cuál)

**Usuario:** el de makro ha traído 6 cajas de coca y 2 de tónica al parador  
&nbsp;&nbsp;*Entendido: Recepción de mercancía · Parador · Coca-Cola · 6 cajas · ¿Varios productos?*  
**Asistente:** ¿Cuál de estos productos es «2 de tónica»?  
&nbsp;&nbsp;Opciones: [Royal Bliss Tónica] [Schweppes Tónica] [Royal Bliss Berry Sensation] [Royal Bliss Ginger Ale]  
✅

**Usuario:** [botón] Schweppes Tónica  
&nbsp;&nbsp;*Entendido: Recepción de mercancía · Parador · Coca-Cola · 6 cajas · Schweppes Tónica · 2 cajas*  
**Asistente:** Revísalo y confírmalo si está bien.  
&nbsp;&nbsp;Borrador: *Recepción en Parador: 6 × Caja 24 de Coca-Cola, 2 × Caja 24 de Schweppes Tónica* — avisos: Precio de Coca-Cola tomado del último albarán (12,96 €); revísalo. / Precio de Schweppes Tónica tomado del último albarán (13,92 €); revísalo. / Proveedor según el último precio: Bebidas Mar Menor S.L..  
✅

## Cierre de noche: roturas y lo que se tira

**Usuario:** anoche se rompieron 2 botellas de beefeater en el vivero  
&nbsp;&nbsp;*Entendido: Registrar merma · Vivero · Beefeater · 2 botellas*  
**Asistente:** Revísalo y confírmalo si está bien.  
&nbsp;&nbsp;Borrador: *Merma: 2 × Botella 70 cl de Beefeater en Vivero*  
✅

**Usuario:** sí, adelante  
&nbsp;&nbsp;*Entendido: Confirmar*  
**Asistente:** Merma registrada.  
✅

**Usuario:** y tira 3 bolsas de hielo picado del vivero  
&nbsp;&nbsp;*Entendido: Registrar merma · Vivero · Hielo picado 2 kg · 3 bolsas*  
**Asistente:** Revísalo y confírmalo si está bien.  
&nbsp;&nbsp;Borrador: *Merma: 3 × Bolsa de Hielo picado 2 kg en Vivero*  
✅

## Estadísticas de un producto: precio, cantidad y consumo

**Usuario:** dame las stats del larios  
&nbsp;&nbsp;*Entendido: Ficha de producto · Larios 12 · Todo*  
**Asistente:** Larios 12 · Destilados para gamas Precio: 10,20 € / Botella 70 cl · Caja 6 a 61,20 € (Distribuciones Premium Sureste S.L.) Stock: 25 botellas (255,00 €) · ⚠ bajo mínimo en 2 locales Consumo 30 días: sin consumo registrado  

| Local | Stock | Valor | Mínimo |
| --- | --- | --- | --- |
| Parador | 10 botellas | 102,00 € | 6 botellas |
| Pickels | 2 botellas | 20,40 € | 6 botellas |
| Vivero | 5 botellas | 51,00 € | 6 botellas |
| La Oliva | 8 botellas | 81,60 € | 6 botellas |

✅

**Usuario:** ¿y en el parador cuánto hay?  
&nbsp;&nbsp;*Entendido: Consultar stock · Parador · Cantidad*  
**Asistente:** Stock de Larios 12 en Parador: 10 botellas.  
✅

## Pregunta de gestión antes del fin de semana

**Usuario:** ¿tengo suficiente coca para el finde en el vivero?  
&nbsp;&nbsp;*Entendido: Qué reponer · Vivero · Coca-Cola · Fin de semana · Cantidad*  
**Asistente:** Para el fin de semana conviene reponer 1 producto: • Coca-Cola (Vivero): quedan 8 ud, pedir 5 cajas + 16 ud — urgencia alta  
✅

**42/43 turnos como se esperaba.**

Coste Jev: 46 llamadas, 102711 tokens de entrada, ~0.004314 $.
