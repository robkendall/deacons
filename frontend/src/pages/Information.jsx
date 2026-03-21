import { useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

import {
    createInformation,
    deleteInformation,
    getAssignableUsers,
    getInformation,
    updateInformation,
} from "../api/ministry";
import PageShell from "../components/PageShell";

function Information({ user }) {
    const [items, setItems] = useState([]);
    const [users, setUsers] = useState([]);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [form, setForm] = useState({ deaconUserId: "", details: "", title: "" });

    async function loadData() {
        setLoading(true);
        setError("");

        try {
            const [information, assignableUsers] = await Promise.all([
                getInformation(),
                getAssignableUsers(),
            ]);
            setItems(information);
            setUsers(assignableUsers);
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        loadData();
    }, []);

    useEffect(() => {
        if (editingId || form.deaconUserId || !user?.id) {
            return;
        }

        const normalizedType = String(user.type || "").toLowerCase();
        const isAssignableType = normalizedType === "deacon" || normalizedType === "yokefellow";
        if (!isAssignableType) {
            return;
        }

        const matchedUser = users.find((assignableUser) => assignableUser.id === user.id);
        if (!matchedUser) {
            return;
        }

        setForm((prev) => ({ ...prev, deaconUserId: String(matchedUser.id) }));
    }, [editingId, form.deaconUserId, user, users]);

    async function handleSubmit(event) {
        event.preventDefault();
        setSaving(true);
        setError("");

        const payload = {
            deaconUserId: Number(form.deaconUserId),
            details: form.details,
            title: form.title,
        };

        try {
            if (editingId) {
                await updateInformation(editingId, payload);
            } else {
                await createInformation(payload);
            }

            setEditingId(null);
            setForm({ deaconUserId: "", details: "", title: "" });
            await loadData();
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setSaving(false);
        }
    }

    function startEdit(item) {
        setEditingId(item.id);
        setForm({
            deaconUserId: String(item.deacon_user_id),
            details: item.details,
            title: item.title,
        });
    }

    async function handleDelete(id) {
        try {
            await deleteInformation(id);
            await loadData();
        } catch (requestError) {
            setError(requestError.message);
        }
    }

    return (
        <PageShell
            eyebrow="Records"
            title="Information"
            description="General information entries for ministry coordination and communication."
        >
            <Box component="form" className="hero-card form-stack" onSubmit={handleSubmit} sx={{ mb: 2 }}>
                {error ? <Alert severity="error">{error}</Alert> : null}
                <TextField label="Title" value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} required />
                <TextField label="Details" value={form.details} onChange={(e) => setForm((p) => ({ ...p, details: e.target.value }))} required multiline minRows={4} />
                <TextField
                    select
                    label="Deacon / Yokefellow"
                    value={form.deaconUserId}
                    onChange={(event) => setForm((prev) => ({ ...prev, deaconUserId: event.target.value }))}
                    required
                >
                    {users.map((listUser) => (
                        <MenuItem key={listUser.id} value={String(listUser.id)}>
                            {listUser.name || listUser.email} ({listUser.email})
                        </MenuItem>
                    ))}
                </TextField>
                <Stack direction="row" spacing={1}>
                    <Button type="submit" variant="contained" disabled={saving}>{saving ? "Saving..." : editingId ? "Update" : "Add"}</Button>
                    {editingId ? <Button variant="outlined" onClick={() => setEditingId(null)}>Cancel edit</Button> : null}
                </Stack>
            </Box>

            {loading ? <Typography>Loading information...</Typography> : null}
            <div className="grid-cards">
                {items.map((item) => (
                    <section key={item.id} className="route-card">
                        <div>
                            <Typography variant="h5" sx={{ mb: 1 }}>{item.title}</Typography>
                            <Typography variant="body2" sx={{ mb: 1 }}>Assigned: {item.deacon_email}</Typography>
                            <Typography variant="body1">{item.details}</Typography>
                        </div>
                        <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
                            <Button size="small" variant="outlined" onClick={() => startEdit(item)}>Edit</Button>
                            <Button size="small" color="error" variant="outlined" onClick={() => handleDelete(item.id)}>Remove</Button>
                        </Stack>
                    </section>
                ))}
            </div>
        </PageShell>
    );
}

export default Information;
