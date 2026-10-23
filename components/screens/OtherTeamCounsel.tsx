import React, { useEffect } from 'react';
import { TeacherTasks } from '@/components/screens/TeacherTasks';
import { useApp } from '@/lib/state';

export function OtherTeamCounsel() {
  const { App } = useApp();
  useEffect(() => { if (!App.otherTeamRoster && !App.ui.otherRosterLoading) App.loadOtherTeamRoster(); }, []);
  return <TeacherTasks otherTeam />;
}
