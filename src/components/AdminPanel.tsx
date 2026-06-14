"use client";

import React, { useState, useEffect } from "react";
import { SafeUser } from "@/lib/auth";

interface AdminPanelProps {
  onClose: () => void;
  onBalanceUpdated?: () => void;
  currentUserId?: string;
}

const getExplorerLink = (method: string | undefined, txHash: string | undefined): string => {
  if (!txHash) return "";
  const cleanTx = txHash.trim();
  switch (method) {
    case "EVM":
      return `https://etherscan.io/tx/${cleanTx}`;
    case "TON":
      return `https://tonviewer.com/transaction/${cleanTx}`;
    case "TRON":
      return `https://tronscan.org/#/transaction/${cleanTx}`;
    case "BTC":
      return `https://mempool.space/tx/${cleanTx}`;
    default:
      return "";
  }
};

interface CreditRequest {
  id: string;
  userId: string;
  email: string;
  packageId: string;
  amount: number;
  status: "pending" | "completed";
  createdAt: string;
  paymentMethod?: string;
  txHash?: string;
}

export default function AdminPanel({ onClose, onBalanceUpdated, currentUserId }: AdminPanelProps) {
  const [activeTab, setActiveTab] = useState<"users" | "requests">("users");
  const [users, setUsers] = useState<SafeUser[]>([]);
  const [requests, setRequests] = useState<CreditRequest[]>([]);
  
  const [loading, setLoading] = useState(true);
  const [loadingRequests, setLoadingRequests] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  
  // Selection & top-up states for Users list tab
  const [selectedUser, setSelectedUser] = useState<SafeUser | null>(null);
  const [fundAmount, setFundAmount] = useState<number>(100);
  const [funding, setFunding] = useState(false);
  const [fundSuccess, setFundSuccess] = useState(false);

  // Fetch users list
  const fetchUsers = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/DiipMynd/api/admin/users");
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || "Failed to load users.");
      }
      
      setUsers(data.users || []);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to load users";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  // Fetch pending requests list
  const fetchRequests = async () => {
    try {
      setLoadingRequests(true);
      setError(null);
      const res = await fetch("/DiipMynd/api/admin/requests");
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || "Failed to load requests.");
      }
      
      setRequests(data.requests || []);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to load requests";
      setError(message);
    } finally {
      setLoadingRequests(false);
    }
  };

  useEffect(() => {
    fetchUsers();
    fetchRequests();
  }, []);

  // Poll requests on tab change
  useEffect(() => {
    if (activeTab === "requests") {
      fetchRequests();
    }
  }, [activeTab]);

  // Handle direct credit update from the right side form
  const handleFundCredits = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;
    
    setFunding(true);
    setError(null);
    setFundSuccess(false);

    try {
      const res = await fetch("/DiipMynd/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: selectedUser.id, amount: fundAmount }),
      });

      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || "Failed to add credits.");
      }

      // Update local users array
      setUsers((prev) =>
        prev.map((u) => (u.id === selectedUser.id ? { ...u, credits: data.user.credits } : u))
      );
      
      // Update selected user display
      setSelectedUser(data.user);
      setFundSuccess(true);

      // If updating yourself, trigger callback
      if (selectedUser.id === currentUserId && onBalanceUpdated) {
        onBalanceUpdated();
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Credit update failed";
      setError(message);
    } finally {
      setFunding(false);
    }
  };

  // Approve a pending user request
  const handleApproveRequest = async (requestId: string, userId: string, amount: number) => {
    setError(null);
    setFundSuccess(false);

    try {
      const res = await fetch("/DiipMynd/api/admin/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to approve request.");
      }

      // Remove request from pending list
      setRequests((prev) => prev.filter((r) => r.id !== requestId));
      
      // Update users array locally
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, credits: u.credits + amount } : u))
      );

      // If selected user details are shown, update them too
      if (selectedUser?.id === userId) {
        setSelectedUser((prev) => prev ? { ...prev, credits: prev.credits + amount } : null);
      }

      // If updating yourself, trigger callback
      if (userId === currentUserId && onBalanceUpdated) {
        onBalanceUpdated();
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Request approval failed";
      setError(message);
    }
  };

  // Filter users by search term
  const filteredUsers = users.filter((u) =>
    u.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Compute stats
  const totalUsers = users.length;
  const totalCredits = users.reduce((acc, u) => acc + u.credits, 0);
  const pendingRequestsCount = requests.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md p-4">
      <div className="w-full max-w-4xl h-[80vh] flex flex-col md:flex-row bg-slate-900 border border-white/10 rounded-3xl overflow-hidden shadow-2xl animate-scaleUp">
        {/* Left Side: Users list / Requests table and tabs */}
        <div className="flex-1 p-6 flex flex-col border-b md:border-b-0 md:border-r border-white/10 overflow-hidden">
          
          {/* Header row */}
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <span>🛡️</span> Developer Admin Panel
            </h2>
            <div className="flex gap-2 text-[10px] text-white/40 uppercase tracking-wider font-semibold">
              <span className="bg-white/5 px-2 py-1 rounded">Users: {totalUsers}</span>
              <span className="bg-white/5 px-2 py-1 rounded">Total Credits: {totalCredits}</span>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="flex gap-2 mb-4 border-b border-white/5 pb-3">
            <button
              onClick={() => setActiveTab("users")}
              className={`px-3.5 py-2 rounded-xl text-xs font-semibold cursor-pointer transition-colors ${
                activeTab === "users"
                  ? "bg-violet-600 text-white"
                  : "bg-white/5 text-white/60 hover:bg-white/10"
              }`}
            >
              Users List
            </button>
            <button
              onClick={() => setActiveTab("requests")}
              className={`px-3.5 py-2 rounded-xl text-xs font-semibold cursor-pointer transition-all flex items-center gap-2 ${
                activeTab === "requests"
                  ? "bg-violet-600 text-white"
                  : "bg-white/5 text-white/60 hover:bg-white/10"
              }`}
            >
              Pending Requests
              {pendingRequestsCount > 0 && (
                <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-rose-500 text-white">
                  {pendingRequestsCount}
                </span>
              )}
            </button>
          </div>

          {/* Tab: Users List */}
          {activeTab === "users" && (
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Search bar */}
              <div className="mb-4">
                <input
                  type="text"
                  placeholder="Search users by email..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder-white/20 text-xs focus:outline-none focus:border-violet-500 transition-colors"
                />
              </div>

              {/* Users Table */}
              <div className="flex-1 overflow-y-auto pr-1">
                {loading ? (
                  <div className="h-full flex items-center justify-center text-xs text-white/40">
                    <div className="w-5 h-5 rounded-full border-2 border-violet-500/20 border-t-violet-400 animate-spin mr-2" />
                    Loading users...
                  </div>
                ) : filteredUsers.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-xs text-white/40">
                    No users found.
                  </div>
                ) : (
                  <table className="w-full text-left text-xs text-white/70 text-right">
                    <thead>
                      <tr className="border-b border-white/5 text-white/30 uppercase text-[9px] tracking-widest text-left">
                        <th className="py-2.5 text-left">Email</th>
                        <th className="py-2.5 text-right">Credits</th>
                        <th className="py-2.5 text-right">Role</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.03]">
                      {filteredUsers.map((user) => (
                        <tr
                          key={user.id}
                          onClick={() => {
                            setSelectedUser(user);
                            setFundSuccess(false);
                          }}
                          className={`hover:bg-white/[0.02] cursor-pointer transition-colors ${
                            selectedUser?.id === user.id ? "bg-violet-500/10 text-white font-medium" : ""
                          }`}
                        >
                          <td className="py-3 pr-2 text-left truncate max-w-[150px]">{user.email}</td>
                          <td className="py-3 text-right tabular-nums">{user.credits}</td>
                          <td className="py-3 text-right font-mono text-[9px]">
                            {user.isAdmin ? (
                              <span className="text-violet-400 bg-violet-400/10 px-1.5 py-0.5 rounded">
                                ADMIN
                              </span>
                            ) : (
                              <span className="text-white/30">USER</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {/* Tab: Pending Requests */}
          {activeTab === "requests" && (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="flex-1 overflow-y-auto pr-1">
                {loadingRequests ? (
                  <div className="h-full flex items-center justify-center text-xs text-white/40">
                    <div className="w-5 h-5 rounded-full border-2 border-violet-500/20 border-t-violet-400 animate-spin mr-2" />
                    Loading credit requests...
                  </div>
                ) : requests.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-xs text-white/40">
                    No pending credit requests at the moment.
                  </div>
                ) : (
                  <table className="w-full text-left text-xs text-white/70">
                    <thead>
                      <tr className="border-b border-white/5 text-white/30 uppercase text-[9px] tracking-widest">
                        <th className="py-2.5">Email</th>
                        <th className="py-2.5">Network</th>
                        <th className="py-2.5">Tx Hash (Explorer)</th>
                        <th className="py-2.5 text-right">Credits</th>
                        <th className="py-2.5 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.03]">
                      {requests.map((req) => {
                        const link = getExplorerLink(req.paymentMethod, req.txHash);
                        return (
                          <tr key={req.id} className="hover:bg-white/[0.02] transition-colors">
                            <td className="py-3 pr-2 truncate max-w-[120px]" title={req.email}>
                              {req.email}
                            </td>
                            <td className="py-3 text-[10px] font-semibold text-white/60">
                              {req.paymentMethod || "N/A"}
                            </td>
                            <td className="py-3 pr-2 truncate max-w-[160px]">
                              {link ? (
                                <a
                                  href={link}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-violet-400 hover:text-violet-300 underline font-mono text-[10px] select-all cursor-pointer"
                                  title="View on Block Explorer"
                                >
                                  {req.txHash}
                                </a>
                              ) : (
                                <span className="font-mono text-[10px] text-white/30">{req.txHash || "N/A"}</span>
                              )}
                            </td>
                            <td className="py-3 text-right tabular-nums font-semibold text-emerald-400">
                              +{req.amount}
                            </td>
                            <td className="py-2 text-right">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleApproveRequest(req.id, req.userId, req.amount);
                                }}
                                className="px-2.5 py-1 text-[10px] bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg cursor-pointer transition-colors active:scale-95 shadow-md shadow-emerald-500/10"
                              >
                                Approve
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

        </div>

        {/* Right Side: Account Funding / Control Form */}
        <div className="w-full md:w-80 p-6 flex flex-col bg-white/[0.01] overflow-y-auto">
          {selectedUser ? (
            <div className="flex-1 flex flex-col justify-between">
              <div>
                <h3 className="text-sm font-bold text-white mb-1">Fund Account</h3>
                <p className="text-xs text-white/40 break-all">{selectedUser.email}</p>

                {/* Details list */}
                <div className="my-6 p-4 rounded-2xl bg-white/[0.02] border border-white/5 text-xs flex flex-col gap-3">
                  <div className="flex justify-between">
                    <span className="text-white/40">Current Credits:</span>
                    <span className="text-white font-semibold tabular-nums">
                      {selectedUser.credits}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-white/40">Admin Status:</span>
                    <span className="text-white font-mono">
                      {selectedUser.isAdmin ? "Yes" : "No"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-white/40">Registered:</span>
                    <span className="text-white/70">
                      {new Date(selectedUser.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>

                {/* Error in panel */}
                {error && (
                  <div className="p-3 mb-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300">
                    {error}
                  </div>
                )}

                {/* Success alert */}
                {fundSuccess && (
                  <div className="p-3 mb-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-300">
                    Credits updated successfully!
                  </div>
                )}

                {/* Input form */}
                <form onSubmit={handleFundCredits} className="flex flex-col gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-semibold text-white/40 uppercase tracking-wide">
                      Amount (Positive to Add, Negative to Deduct)
                    </label>
                    <input
                      type="number"
                      value={fundAmount}
                      onChange={(e) => setFundAmount(parseInt(e.target.value) || 0)}
                      disabled={funding}
                      className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white focus:outline-none focus:border-violet-500 transition-colors text-sm font-semibold text-center"
                    />
                  </div>

                  {/* Preset quick buttons */}
                  <div className="grid grid-cols-3 gap-2">
                    {[100, 500, 1000].map((amount) => (
                      <button
                        key={amount}
                        type="button"
                        onClick={() => setFundAmount(amount)}
                        className="py-2 text-[10px] font-semibold bg-white/5 hover:bg-white/10 rounded-lg text-white border border-white/5 active:scale-95 transition-all"
                      >
                        +{amount}
                      </button>
                    ))}
                  </div>

                  <button
                    type="submit"
                    disabled={funding}
                    className="w-full mt-4 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold active:scale-95 transition-all cursor-pointer flex items-center justify-center gap-2"
                  >
                    {funding ? (
                      <>
                        <div className="w-3.5 h-3.5 rounded-full border-2 border-white/20 border-t-white animate-spin" />
                        Updating...
                      </>
                    ) : (
                      "Apply Balance Change"
                    )}
                  </button>
                </form>
              </div>

              {/* Close Button inside controls */}
              <button
                onClick={onClose}
                className="mt-6 py-2.5 text-center text-xs font-semibold text-white/40 hover:text-white border border-white/10 rounded-xl hover:bg-white/5 active:scale-95 transition-all cursor-pointer"
              >
                Close Panel
              </button>
            </div>
          ) : (
            <div className="flex-1 flex flex-col justify-between items-center text-center p-4">
              <div className="my-auto flex flex-col items-center">
                <span className="text-3xl mb-3">👈</span>
                <p className="text-xs text-white/40 max-w-[180px]">
                  Select a user from the Users List tab to top up their credit balance.
                </p>
              </div>

              <button
                onClick={onClose}
                className="w-full py-2.5 text-center text-xs font-semibold text-white/40 hover:text-white border border-white/10 rounded-xl hover:bg-white/5 active:scale-95 transition-all cursor-pointer"
              >
                Close Panel
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
