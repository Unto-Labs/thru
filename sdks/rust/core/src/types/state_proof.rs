use crate::Pubkey;

#[derive(Debug)]
pub enum ProofParseError {
    Truncated,
    TooManyKeys(usize),
    MisSized,
    InvalidProofType,
    NotSupported,
    NotAvailable,
}

pub enum ProofType {
    Existing = 0,
    Updating = 1,
    Creation = 2,
}

pub const PROOF_KEYS_MAX: usize = 256;

// Do not attempt to construct manually. Use parse_proof or parse_proof_prefix.
#[repr(C, packed)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct StateProof {
    type_slot: u64,
    path_bitset: Pubkey,

    // Followed by Pubkeys
}

impl StateProof {
    pub fn proof_type(&self) -> Result<ProofType, ProofParseError> {
        let tp = match self.type_slot >> 62 {
            0 => ProofType::Existing,
            1 => ProofType::Updating,
            2 => ProofType::Creation,
            _ => return Err(ProofParseError::InvalidProofType),
        };

        Ok(tp)
    }

    pub fn slot(&self) -> u64 {
        self.type_slot & ((1u64 << 62) - 1)
    }

    pub unsafe fn footprint_unchecked(&self) -> usize {
        let sibling_hash_cnt = self.path_bitset.0.iter().map(|value| value.count_ones() as usize).sum::<usize>();

        let proof_type = (self.type_slot >> 62) as usize;
        let body_sz = (proof_type + sibling_hash_cnt) * core::mem::size_of::<Pubkey>();

        core::mem::size_of::<Self>() + body_sz
    }

    pub fn footprint(&self) -> Result<usize, ProofParseError> {
        let sibling_hash_cnt = self.path_bitset.0.iter().map(|value| value.count_ones() as usize).sum::<usize>();

        let proof_type = self.proof_type()? as usize;
        let body_sz = (proof_type + sibling_hash_cnt) * core::mem::size_of::<Pubkey>();

        Ok(core::mem::size_of::<Self>() + body_sz)
    }

    pub unsafe fn parse_proof_unchecked<'a>(proof_data: *const u8) -> &'a Self {
        unsafe { &*(proof_data as *const Self) }
    }

    // INVARIANT: The returned proof starts at the beginning of proof_data and the suffix is the remaining data
    pub fn parse_proof_prefix(proof_data: &[u8]) -> Result<(&StateProof, &[u8]), ProofParseError> {
        if proof_data.len() < core::mem::size_of::<Self>() {
            return Err(ProofParseError::Truncated);
        }

        let hdr = unsafe { &*(proof_data.as_ptr() as *const Self) };
        let total_length = hdr.footprint()? as usize;

        let (_proof, suffix) = proof_data
            .split_at_checked(total_length)
            .ok_or(ProofParseError::Truncated)?;

        Ok((hdr, suffix))
    }

    // INVARIANT: The wide-pointer points to the memory range of proof_data
    pub fn parse_proof(proof_data: &[u8]) -> Result<&StateProof, ProofParseError> {
        let (proof, suffix) = Self::parse_proof_prefix(proof_data)?;

        match suffix.len() {
            0 => Ok(proof),
            _ => Err(ProofParseError::MisSized),
        }
    }
}

#[repr(C, packed)]
pub struct ExistingProof {
    pub hdr: StateProof,
    pub sibling_hashes: [Pubkey],
}

#[repr(C, packed)]
pub struct UpdatingProof {
    pub hdr: StateProof,
    pub existing_leaf_hash: Pubkey,
    pub sibling_hashes: [Pubkey],
}

#[repr(C, packed)]
pub struct CreationProof {
    pub hdr: StateProof,
    pub existing_leaf_pubkey: Pubkey,
    pub existing_leaf_hash: Pubkey,
    pub sibling_hashes: [Pubkey],
}
