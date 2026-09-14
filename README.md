# MTG Token Printer

App web (HTML5, sem build, sem backend) para criar tokens de Magic: The
Gathering por voz e imprimir direto numa impressora térmica **Niimbot** via
Web Bluetooth.

Fluxo: toque no microfone → descreva o token em inglês (ex.: *"1/1 black
faerie with flying"*) → o app monta uma busca no [Scryfall](https://scryfall.com)
→ você escolhe a arte → o app imprime na etiqueta.

## Compatibilidade

| Plataforma | Voz (Web Speech API) | Bluetooth (impressão) |
|---|---|---|
| **Android** (Chrome/Edge/Samsung Internet) | ✅ | ✅ |
| **Windows** (Chrome/Edge) | ✅ | ✅ |
| **iOS/iPadOS** | ❌ (WebKit não implementa `SpeechRecognition`, nem no Bluefy) | ✅ via [Bluefy](https://apps.apple.com/us/app/bluefy-web-ble-browser/id1492822055) |

**iOS não é suportado por enquanto**: o Safari/WebKit (e portanto o Bluefy,
que é um WebKit com um polyfill de Bluetooth) não implementa a parte de
reconhecimento de voz da Web Speech API — só a parte de texto-para-voz. Dá
para digitar a descrição manualmente no campo de texto do app mesmo no
iPhone/iPad e ainda assim imprimir via Bluefy, mas a entrada por voz em si só
funciona no Android e no Windows.

No Android, **Bluetooth e Localização precisam estar ligados** (o Android
amarra o scan de BLE à localização), e o app precisa ser aberto no navegador
de verdade (Chrome), não numa WebView interna de outro app.

## Rodando localmente

Web Bluetooth e a Web Speech API exigem contexto seguro (HTTPS ou
`localhost`). Para testar localmente, sirva a pasta com qualquer servidor
estático, por exemplo:

```bash
python3 -m http.server 8080
```

Abra `http://localhost:8080` no Chrome.

## Publicando no GitHub Pages

```bash
git add -A
git commit -m "..."
git remote add origin <url-do-seu-repo>
git push -u origin main
```

Depois, no GitHub: **Settings → Pages → Deploy from a branch → main / (root)**.
Não há passo de build — é HTML/CSS/JS puro.

## Configurando a impressora

No ícone de engrenagem (⚙️) dá para escolher:
- **Modelo Niimbot** (B1, B1 Pro, B2 Pro, M2-H, D11_H, D110, N1)
- **Tamanho da etiqueta** (a lista já filtra só os tamanhos compatíveis com o
  modelo escolhido)
- **Densidade de impressão** (1–5)

Na tela de impressão, o botão **Conectar impressora** abre o seletor de
Bluetooth do navegador e identifica automaticamente o modelo conectado
(ajustando a seleção se você tinha escolhido o modelo errado).

## Como a busca por voz funciona

O reconhecimento de voz roda em inglês por padrão (os termos do Magic —
cores, tipos de criatura, palavras-chave — são em inglês). O texto
reconhecido passa por um parser (`js/voice-query.js`) que extrai:

- poder/resistência (`1/1`, `2 2`, "one one" etc.)
- cores (`black`, `white`, `blue`, `red`, `green`, `colorless`/`artifact`)
- tipo de criatura (comparado com o catálogo oficial do Scryfall, com
  correção aproximada para erros comuns de transcrição — ex. "fairie" →
  "Faerie")
- palavras-chave (`flying`, `trample`, `vigilance`, `deathtouch`, `lifelink`,
  `haste`, `menace`, `reach`, `first strike`, `double strike`, etc.)
- tokens não-criatura conhecidos (`clue`, `treasure`, `food`, `blood`,
  `gold`, `map`, `powerstone`...) e `emblem`

e monta uma query do Scryfall (`t:token c:b pow=1 tou=1 t:"Faerie" o:"flying"`).
Antes de buscar, você sempre vê e pode editar a transcrição (ou a query
avançada) numa tela de confirmação. Se a busca estruturada não achar nada, o
app relaxa progressivamente (remove palavras-chave, depois p/r, depois o
tipo) até achar alguma coisa.

## Créditos / licenças

O driver Bluetooth (`vendor/niimbot.js`, `vendor/niimbot-registry.json`) é
vendorizado, sem modificações, do projeto
[niimbot-web-bluetooth](https://github.com/iscarelli/niimbot-web-bluetooth)
de Dimitri Carelli, licença MIT (`vendor/niimbot-LICENSE.txt`). Dados de
cartas e imagens via API pública do [Scryfall](https://scryfall.com) (uso não
comercial, ver [termos](https://scryfall.com/docs/api)).
