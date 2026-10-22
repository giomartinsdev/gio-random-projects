package postgres

// nullableTime turns a zero time into NULL so the column can stay nullable
// without a sentinel year-1 timestamp.
//
// Vive num arquivo próprio porque não pertence a nenhum agregado: nasceu no
// repositório de preferências (clubs) e era usado pelo financeiro, então saiu
// junto quando aquele agregado foi removido. Ficou aqui para os repositórios do
// finance continuarem compilando sem depender de um domínio que não existe
// mais.
func nullableTime(t interface{ IsZero() bool }) any {
	return nullableTimeValue(t)
}

func nullableTimeValue(t interface{ IsZero() bool }) any {
	if t.IsZero() {
		return nil
	}
	return t
}
