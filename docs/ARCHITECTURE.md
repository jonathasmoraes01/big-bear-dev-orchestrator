# Arquitetura

## Restrições reais que moldaram o desenho

Levantadas na API de mods do Claude Code (tipos gerados pelo próprio motor, builds 2.1.284 e 2.1.293) e confirmadas pelo `claude plugin validate`:

1. **`$` não cruza imports.** O motor segue o `$` só para funções declaradas no mesmo arquivo que o recebeu. Por isso existe uma camada única de captura de eventos (`hooks/register.tsx`) que monta um objeto `Io` com as capacidades e o entrega aos módulos.
2. **Estado lido estaticamente.** Toda leitura e escrita de `$.state` precisa ser rastreável até um `atom` com `plugin` e `key` literais, no mesmo arquivo. Os átomos vivem em `register.tsx`; os módulos usam `io.state.<chave>.get()/set()`.
3. **Um hook sem matcher por evento.** Os guardiões usam matchers (`{ tool: 'Bash' }`), o rastreador de ferramentas é o único `tool.call` sem matcher.
4. **Sem Node, sem DOM.** Arquivos, processos, relógio e armazenamento passam pelo motor (`$.fs`, `$.process`, `$.clock`, `$.store`).
5. **Imagens**: o app desktop desenha `Svg` (não `Image`); o terminal desenha `Raster`. O painel usa os elementos nativos (Box, Text, Button) em todas as superfícies, com o urso em pixel art (SVG no desktop, células de meio-bloco no terminal), e se adapta à altura recebida. A tabela de elementos responde `in` para qualquer nome, então o kit escolhe pelo `e.surface`.

## Camadas

```
hooks/register.tsx        captura de eventos, átomos de estado, construção do Io
hooks/src/
  services/io.ts          tipo Io: a única porta dos módulos para o motor
  config/defaults.ts      configuração padrão, preços, mescla segura do armazenado
  config/project-profiles perfil Ragnarok Classic Idle
  core/classifier.ts      classificação local do pedido (puro)
  core/router.ts          decisão de modelo, modos, cache, histórico, escalonamento (puro)
  core/tasks.ts           ciclo de vida das tarefas, marcos, avatar (puro)
  core/orchestrator.ts    Smart Brain + Task Command: handlers de eventos sobre Io
  core/runtime.ts         memória de trabalho do módulo (perdível num reload)
  modules/guardian.ts     regras de comandos perigosos, segredos, caminhos críticos (puro)
  modules/guard-hooks.ts  decisão do Code/Git Guardian sobre Io
  modules/git.ts          leitura do git status (puro)
  modules/qa.ts           descoberta de scripts e planos de QA (puro)
  modules/monitor.ts      Usage Monitor e Context Manager
  services/pricing.ts     custo equivalente, economia, distribuição (puro)
  services/analytics.ts   histórico, estatísticas, estimativas (puro)
  services/engine.ts      persistência, git, QA real, alertas (sobre Io)
  commands.ts             /bigbear e subcomandos
  ui/model.ts             o que o painel mostra, calculado uma vez (puro)
  ui/                     painel, faixa, configurações, showcase, avatar
types/index.d.ts          contrato do estado do mod (validado pelo motor)
tests/                    unitários (puros) e de integração (contra o motor)
tools/build-avatars.py    gera ui/avatar-data.ts a partir de assets/avatar
```

Separação pedida: captura de eventos (`register.tsx`), regras de decisão (`core/classifier`, `core/router`, `modules/guardian`, `modules/qa`), estado (átomos + `types/index.d.ts`), persistência (`services/engine`), interface (`ui/`), telemetria local (`services/analytics`, `services/pricing`), segurança (`modules/guardian`, `modules/guard-hooks`).

## Fluxo de um pedido

1. `prompt.submit` → `classify` (regras locais) → `decide` (modo, manual, continuação, histórico, cache, bloqueios) → tarefa `ANALYZING`, marco 1.
2. `turn.start` → tarefa `RUNNING`, marco 2; registra o turno.
3. `turn.step` (cada requisição ao modelo) → `beforeStep` troca o `model` da requisição, escalando um nível se o turno acumulou falhas de ferramenta; a resposta passa; `afterStep` soma os tokens reais por modelo, marco 3.
4. `tool.call` → `WAITING <ferramenta>` enquanto roda; erro conta para o escalonamento; edição arma o QA automático. Guardiões avaliam Bash/PowerShell/Edit/Write antes.
5. `agent.spawn` → escolhe modelo do subagente quando a chamada não definiu; tarefa-filha na árvore com o `agentId` real.
6. `turn.complete` → `COMPLETED` (marcos 5/5), `CANCELLED`, `FAILED`, ou `VALIDATING` com o QA rodando num timer da sessão; grava o histórico; atualiza o git.
7. `session.measure` → janelas de uso, contexto, alertas.

## Desempenho

Classificação por regex, sem chamada de modelo (a IA é opcional e só com baixa confiança). Um único timer (padrão 1 s) que só escreve enquanto há tarefa aberta. Git consultado no máximo a cada 5 s, após turnos. Até 60 tarefas no estado e 1000 registros no histórico. Hooks com `.catch` que deixam a sessão seguir se um módulo falhar; o guardião de shell, se falhar, ainda bloqueia o que as regras puras chamam de irreversível.
