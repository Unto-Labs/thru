use crate::tn_public_address::tn_pubkey_to_address_string;
use core::mem::size_of;

pub const TN_ACCOUNT_DATA_SZ_MAX: usize = 16 * 1024 * 1024; // Max account data size (excluding metadata)
pub const TN_ACCOUNT_PAGE_SZ: usize = 128; // Size of pages
pub const TN_ACCOUNT_PAGE_CNT_MAX: usize = TN_ACCOUNT_DATA_SZ_MAX / TN_ACCOUNT_PAGE_SZ;

pub const TN_ACCOUNT_VERSION_V1: u8 = 0x01;

pub const TN_ACCOUNT_FLAG_PROGRAM: u8 = 0x01;
pub const TN_ACCOUNT_FLAG_PRIVILEGED: u8 = 0x02;
pub const TN_ACCOUNT_FLAG_UNCOMPRESSABLE: u8 = 0x04;
pub const TN_ACCOUNT_FLAG_EPHEMERAL: u8 = 0x08;
pub const TN_ACCOUNT_FLAG_DELETED: u8 = 0x10;
pub const TN_ACCOUNT_FLAG_NEW: u8 = 0x20;
pub const TN_ACCOUNT_FLAG_COMPRESSED: u8 = 0x40;

#[repr(C, packed)]
#[derive(Clone)]
pub struct TnAccountMeta {
    pub magic: u16,
    pub version: u8,
    pub flags: u8,
    pub data_sz: u32,
    pub state_counter: u64,
    pub owner: [u8; 32], // fd_pubkey_t assumed to be 32 bytes
    pub balance: u64,
    pub nonce: u64,
}

pub const TN_ACCOUNT_META_MAGIC: u16 = 0xC7A3;
pub const TN_ACCOUNT_META_FOOTPRINT: usize = size_of::<TnAccountMeta>();

#[repr(C, align(16))]
pub struct TnTxnAccountPageTable {
    pub magic: u64, // == TN_TXN_ACCOUNT_PAGE_TABLE_MAGIC
}

// Inline/static functions with bodies
impl TnAccountMeta {
    pub fn size(&self) -> usize {
        TN_ACCOUNT_META_FOOTPRINT + self.data_sz as usize
    }

    /// Serialize account metadata to wire format (bytes)
    pub fn to_wire(&self) -> Vec<u8> {
        use core::mem::size_of;
        let mut result = Vec::with_capacity(size_of::<TnAccountMeta>());

        // Since the struct is #[repr(C, packed)], we can serialize it directly
        // But we need to be careful about alignment and endianness
        result.extend_from_slice(&self.magic.to_le_bytes());
        result.push(self.version);
        result.push(self.flags);
        result.extend_from_slice(&self.data_sz.to_le_bytes());
        result.extend_from_slice(&self.state_counter.to_le_bytes());
        result.extend_from_slice(&self.owner);
        result.extend_from_slice(&self.balance.to_le_bytes());
        result.extend_from_slice(&self.nonce.to_le_bytes());

        result
    }

    /// Deserialize account metadata from wire format (bytes)
    pub fn from_wire(bytes: &[u8]) -> Option<Self> {
        use core::mem::size_of;

        if bytes.len() < size_of::<TnAccountMeta>() {
            return None;
        }

        let mut offset = 0;

        // Parse magic (2 bytes)
        let magic = u16::from_le_bytes([bytes[offset], bytes[offset + 1]]);
        offset += 2;

        // Parse version (1 byte)
        let version = bytes[offset];
        offset += 1;

        // Parse flags (1 byte)
        let flags = bytes[offset];
        offset += 1;

        // Parse data_sz (4 bytes)
        let data_sz = u32::from_le_bytes([
            bytes[offset],
            bytes[offset + 1],
            bytes[offset + 2],
            bytes[offset + 3],
        ]);
        offset += 4;

        // Parse state_counter (8 bytes)
        let state_counter = u64::from_le_bytes([
            bytes[offset],
            bytes[offset + 1],
            bytes[offset + 2],
            bytes[offset + 3],
            bytes[offset + 4],
            bytes[offset + 5],
            bytes[offset + 6],
            bytes[offset + 7],
        ]);
        offset += 8;

        // Parse owner (32 bytes)
        let mut owner = [0u8; 32];
        owner.copy_from_slice(&bytes[offset..offset + 32]);
        offset += 32;

        // Parse balance (8 bytes)
        let balance = u64::from_le_bytes([
            bytes[offset],
            bytes[offset + 1],
            bytes[offset + 2],
            bytes[offset + 3],
            bytes[offset + 4],
            bytes[offset + 5],
            bytes[offset + 6],
            bytes[offset + 7],
        ]);
        offset += 8;

        // Parse nonce (8 bytes)
        let nonce = u64::from_le_bytes([
            bytes[offset],
            bytes[offset + 1],
            bytes[offset + 2],
            bytes[offset + 3],
            bytes[offset + 4],
            bytes[offset + 5],
            bytes[offset + 6],
            bytes[offset + 7],
        ]);

        Some(TnAccountMeta {
            magic,
            version,
            flags,
            data_sz,
            state_counter,
            owner,
            balance,
            nonce,
        })
    }
}

impl Default for TnAccountMeta {
    fn default() -> Self {
        Self {
            magic: TN_ACCOUNT_META_MAGIC,
            version: TN_ACCOUNT_VERSION_V1,
            flags: 0,
            data_sz: 0,
            state_counter: 0,
            owner: [0; 32],
            balance: 0,
            nonce: 0,
        }
    }
}

impl core::fmt::Debug for TnAccountMeta {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        // Copy packed fields to local variables to avoid unaligned references
        let magic = self.magic;
        let version = self.version;
        let flags = self.flags;
        let owner = self.owner;
        let data_sz = self.data_sz;
        let balance = self.balance;
        let nonce = self.nonce;
        let state_counter = self.state_counter;
        let owner_addr = tn_pubkey_to_address_string(&owner);
        f.debug_struct("TnAccountMeta")
            .field("magic", &magic)
            .field("version", &version)
            .field("flags", &flags)
            .field("owner", &owner_addr)
            .field("data_sz", &data_sz)
            .field("balance", &balance)
            .field("nonce", &nonce)
            .field("state_counter", &state_counter)
            .finish()
    }
}

// Standalone functions
pub fn tn_account_is_active(meta: Option<&TnAccountMeta>) -> bool {
    // TODO: this will need to change to be correct.
    meta.is_some()
}

pub fn tn_account_is_deleted(meta: &TnAccountMeta) -> bool {
    (meta.flags & TN_ACCOUNT_FLAG_DELETED) != 0
}

pub fn tn_account_exists(meta: Option<&TnAccountMeta>) -> bool {
    tn_account_is_active(meta) && meta.map_or(false, |m| !tn_account_is_deleted(m))
}

pub fn tn_account_is_ephemeral(meta: &TnAccountMeta) -> bool {
    (meta.flags & TN_ACCOUNT_FLAG_EPHEMERAL) != 0
}

pub fn tn_account_is_new(meta: &TnAccountMeta) -> bool {
    (meta.flags & TN_ACCOUNT_FLAG_NEW) != 0
}

pub fn tn_account_is_program(meta: &TnAccountMeta) -> bool {
    (meta.flags & TN_ACCOUNT_FLAG_PROGRAM) != 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_account_meta_wire_serialization_basic() {
        // Test basic serialization with default values
        let meta = TnAccountMeta::default();
        let wire_bytes = meta.to_wire();

        // Verify the wire format has the expected size
        assert_eq!(wire_bytes.len(), TN_ACCOUNT_META_FOOTPRINT);

        // Deserialize from wire format and verify it succeeds
        let _deserialized = TnAccountMeta::from_wire(&wire_bytes).unwrap();

        // Test that the round-trip works correctly by re-serializing
        let second_wire_bytes = _deserialized.to_wire();
        assert_eq!(wire_bytes, second_wire_bytes);
    }

    #[test]
    fn test_account_meta_from_wire_invalid_size() {
        // Test with insufficient bytes
        let short_bytes = vec![0u8; 10];
        assert!(TnAccountMeta::from_wire(&short_bytes).is_none());

        // Test with empty bytes
        let empty_bytes = vec![];
        assert!(TnAccountMeta::from_wire(&empty_bytes).is_none());
    }

    #[test]
    fn test_account_meta_size_calculation() {
        // Test size calculation without accessing packed fields directly
        let meta = TnAccountMeta::default();
        assert_eq!(meta.size(), TN_ACCOUNT_META_FOOTPRINT);
    }
}
