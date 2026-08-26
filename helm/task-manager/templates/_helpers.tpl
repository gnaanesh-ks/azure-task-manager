{{- define "task-manager.fullname" -}}
{{ .Release.Name }}
{{- end -}}

{{- define "task-manager.image" -}}
{{ .root.Values.image.registry }}/{{ .repository }}:{{ .root.Values.image.tag }}
{{- end -}}

{{- define "task-manager.databaseUrl" -}}
{{- if .Values.postgresql.enabled -}}
postgresql://{{ .Values.postgresql.username }}:{{ .Values.secrets.postgresPassword }}@{{ .Release.Name }}-postgresql:5432/{{ .Values.postgresql.database }}
{{- else -}}
{{ .Values.externalDatabaseUrl }}
{{- end -}}
{{- end -}}
