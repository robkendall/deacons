import { apiFetch } from "./client";

async function readJson(response) {
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "Request failed.");
  }

  return data;
}

async function request(path, options = {}) {
  const response = await apiFetch(path, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  return readJson(response);
}

export function getDashboard() {
  return request("/api/dashboard");
}

export function getUsers() {
  return request("/api/users");
}

export function createUser(payload) {
  return request("/api/users", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateUser(id, payload) {
  return request(`/api/users/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function deleteUser(id) {
  return request(`/api/users/${id}`, {
    method: "DELETE",
  });
}

export function getPeople() {
  return request("/api/people");
}

export function createPerson(payload) {
  return request("/api/people", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updatePerson(id, payload) {
  return request(`/api/people/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function deletePerson(id) {
  return request(`/api/people/${id}`, {
    method: "DELETE",
  });
}

export function getNormalWeeks() {
  return request("/api/normal-weeks");
}

export function createNormalWeek(payload) {
  return request("/api/normal-weeks", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function deleteNormalWeek(id) {
  return request(`/api/normal-weeks/${id}`, {
    method: "DELETE",
  });
}

export function getBlockedOut() {
  return request("/api/blocked-out");
}

export function createBlockedOut(payload) {
  return request("/api/blocked-out", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function deleteBlockedOut(id) {
  return request(`/api/blocked-out/${id}`, {
    method: "DELETE",
  });
}

export function getPositions() {
  return request("/api/positions");
}

export function createPosition(payload) {
  return request("/api/positions", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updatePosition(id, payload) {
  return request(`/api/positions/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function reorderPositions(orderedPositionIds) {
  return request("/api/positions/reorder", {
    method: "PUT",
    body: JSON.stringify({ orderedPositionIds }),
  });
}

export function deletePosition(id) {
  return request(`/api/positions/${id}`, {
    method: "DELETE",
  });
}

export function getPeoplePositions() {
  return request("/api/people-positions");
}

export function addPersonPosition(personId, positionId) {
  return request(`/api/people/${personId}/positions`, {
    method: "POST",
    body: JSON.stringify({ positionId }),
  });
}

export function reorderPersonPositions(personId, orderedPositionIds) {
  return request(`/api/people/${personId}/positions/reorder`, {
    method: "PUT",
    body: JSON.stringify({ orderedPositionIds }),
  });
}

export function removePersonPosition(personId, positionId) {
  return request(`/api/people/${personId}/positions/${positionId}`, {
    method: "DELETE",
  });
}

export function getSchedule(month) {
  const query = month ? `?month=${encodeURIComponent(month)}` : "";
  return request(`/api/schedule${query}`);
}

export function prepopulateSchedule(month) {
  return request("/api/schedule/prepopulate", {
    method: "POST",
    body: JSON.stringify({ month }),
  });
}

export function createPeopleSchedule(payload) {
  return request("/api/people-schedule", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updatePeopleSchedule(id, payload) {
  return request(`/api/people-schedule/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function deletePeopleSchedule(id) {
  return request(`/api/people-schedule/${id}`, {
    method: "DELETE",
  });
}

export function clearScheduleAssignments(scheduleId) {
  return request(`/api/schedule/${scheduleId}/assignments`, {
    method: "DELETE",
  });
}

export function clearScheduleMonth(month) {
  const query = month ? `?month=${encodeURIComponent(month)}` : "";
  return request(`/api/schedule${query}`, {
    method: "DELETE",
  });
}
