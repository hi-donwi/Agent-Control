import { useState, useEffect } from 'react';
import { apiFetch } from '../lib/api';
import type { ProjectInfo, ProjectsResponse } from '../lib/types';

/** The projects a chat can be bound to, with the endpoints each one allows. */
export function useProjects() {
  const [projects, setProjects] = useState<ProjectInfo[]>([]);

  useEffect(() => {
    apiFetch<ProjectsResponse>('projects')
      .then((data) => setProjects(data.projects))
      .catch(() => { /* workspace not reachable: unbound chat only */ });
  }, []);

  return { projects };
}
