#!/bin/bash
# Compatibilidade: o script foi renomeado para `copy-volume.sh` quando deixou de
# ser só da observabilidade (o minio veio na fatia 5). Mantido para não quebrar
# hábito nem histórico de comandos; repassa todos os argumentos.
exec "$(dirname "$0")/copy-volume.sh" "$@"
